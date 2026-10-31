#include "joulelab.h"
#include "jl_protocol.h"

#if (JL_TX_BUFFER_SIZE & (JL_TX_BUFFER_SIZE - 1)) != 0
#error "JL_TX_BUFFER_SIZE must be a power of two"
#endif
#if JL_SAMPLE_PERIOD_US < 1500u
#error "JL_SAMPLE_PERIOD_US below 1500 us exceeds what 115200 baud and the INA219 can deliver"
#endif

#define INA219_REG_CONFIG  0x00u
#define INA219_REG_SHUNT   0x01u
#define INA219_REG_BUS     0x02u
#define SENSOR_LOST_AFTER  25u  /* consecutive I2C failures before the sensor is treated as missing */

static UART_HandleTypeDef *s_uart;
static I2C_HandleTypeDef *s_i2c;
static TIM_HandleTypeDef *s_clock_tim;
static TIM_HandleTypeDef *s_sample_tim;

/* ---- TX ring buffer (filled from any context, drained by USART2 interrupts) ---- */
static uint8_t s_tx[JL_TX_BUFFER_SIZE];
static volatile uint32_t s_head, s_tail, s_inflight;
static volatile uint8_t s_tx_busy;
static volatile uint32_t s_tx_dropped;

/* ---- sampling state ---- */
static volatile uint8_t s_seq;            /* 8-bit sample counter (also for lost samples) */
static volatile uint8_t s_last_seq;       /* seq of the most recent sample started */
static volatile uint8_t s_i2c_busy;
static volatile uint8_t s_stage;          /* 0 = reading shunt, 1 = reading bus */
static volatile uint8_t s_cur_seq;
static volatile uint32_t s_cur_t;
static volatile int16_t s_shunt_raw;
static uint8_t s_rx[2];
static volatile uint32_t s_samples_done;
static volatile uint32_t s_since_sync = JL_TIME_SYNC_EVERY; /* send a TIME_SYNC with the first sample */
static volatile uint8_t s_sensor_ok;
static volatile uint32_t s_consecutive_fail;
static volatile uint32_t s_i2c_fail_total, s_overrun_total, s_overflow_total;
static volatile uint32_t s_last_i2c_error;

static inline uint32_t irq_save(void) { uint32_t p = __get_PRIMASK(); __disable_irq(); return p; }
static inline void irq_restore(uint32_t p) { __set_PRIMASK(p); }

static void tx_kick(void) /* call with interrupts disabled */
{
    if (s_tx_busy || s_head == s_tail) return;
    uint32_t tail = s_tail & (JL_TX_BUFFER_SIZE - 1u);
    uint32_t used = s_head - s_tail;
    uint32_t chunk = JL_TX_BUFFER_SIZE - tail;      /* contiguous bytes up to the end of the buffer */
    if (chunk > used) chunk = used;
    if (HAL_UART_Transmit_IT(s_uart, &s_tx[tail], (uint16_t)chunk) == HAL_OK) {
        s_inflight = chunk;
        s_tx_busy = 1;
    }
}

static void send_packet(uint8_t type, uint32_t v1, uint16_t v2, uint8_t seq)
{
    uint8_t pkt[JL_PACKET_SIZE];
    jl_build_packet(pkt, type, v1, v2, seq);
    uint32_t p = irq_save();
    if (JL_TX_BUFFER_SIZE - (s_head - s_tail) < JL_PACKET_SIZE) {
        s_tx_dropped++;                 /* host sees the missing seq / gets a TX_OVERFLOW report */
    } else {
        for (uint32_t i = 0; i < JL_PACKET_SIZE; i++) {
            s_tx[(s_head + i) & (JL_TX_BUFFER_SIZE - 1u)] = pkt[i];
        }
        s_head += JL_PACKET_SIZE;
        tx_kick();
    }
    irq_restore(p);
}

void jl_on_uart_tx_done(UART_HandleTypeDef *huart)
{
    if (huart != s_uart) return;
    uint32_t p = irq_save();
    s_tail += s_inflight;
    s_inflight = 0;
    s_tx_busy = 0;
    tx_kick();
    irq_restore(p);
}

/* ---- INA219 ---- */
static HAL_StatusTypeDef ina219_configure(void) /* blocking; main context only */
{
    uint8_t cfg[2] = { (uint8_t)(JL_INA219_CONFIG >> 8), (uint8_t)JL_INA219_CONFIG };
    if (HAL_I2C_IsDeviceReady(s_i2c, JL_INA219_ADDR << 1, 3, 10) != HAL_OK) return HAL_ERROR;
    return HAL_I2C_Mem_Write(s_i2c, JL_INA219_ADDR << 1, INA219_REG_CONFIG, I2C_MEMADD_SIZE_8BIT, cfg, 2, 10);
}

void jl_on_timer(TIM_HandleTypeDef *htim)
{
    if (htim != s_sample_tim) return;
    uint32_t t = jl_now_us();
    uint8_t seq = s_seq++;
    s_last_seq = seq;
    if (!s_sensor_ok) return;                    /* sample lost: host sees the seq gap */
    if (s_i2c_busy) { s_overrun_total++; return; }
    s_cur_t = t;
    s_cur_seq = seq;
    s_stage = 0;
    s_i2c_busy = 1;
    if (HAL_I2C_Mem_Read_IT(s_i2c, JL_INA219_ADDR << 1, INA219_REG_SHUNT, I2C_MEMADD_SIZE_8BIT, s_rx, 2) != HAL_OK) {
        s_i2c_busy = 0;
        s_i2c_fail_total++;
        s_consecutive_fail++;
    }
}

void jl_on_i2c_rx_done(I2C_HandleTypeDef *hi2c)
{
    if (hi2c != s_i2c) return;
    if (s_stage == 0) {
        s_shunt_raw = (int16_t)((s_rx[0] << 8) | s_rx[1]);
        s_stage = 1;
        if (HAL_I2C_Mem_Read_IT(s_i2c, JL_INA219_ADDR << 1, INA219_REG_BUS, I2C_MEMADD_SIZE_8BIT, s_rx, 2) != HAL_OK) {
            s_i2c_busy = 0;
            s_i2c_fail_total++;
            s_consecutive_fail++;
        }
        return;
    }
    uint16_t bus_raw = (uint16_t)((s_rx[0] << 8) | s_rx[1]);
    int16_t shunt = s_shunt_raw;
    uint8_t seq = s_cur_seq;
    uint32_t t = s_cur_t;
    s_i2c_busy = 0;
    s_consecutive_fail = 0;

    /* OVF flag, or shunt at the +-320 mV full scale of PGA /8: the reading is not trustworthy */
    if ((bus_raw & 0x0001u) || shunt >= 32000 || shunt <= -32000) {
        s_overflow_total++;
        send_packet(JL_PKT_DEVICE_STATUS, (uint32_t)(uint16_t)shunt, JL_ST_INA219_OVERFLOW, seq);
        return;                                  /* no MEASUREMENT for this seq: host treats it as lost */
    }
    /* shunt LSB = 10 uV; I[uA] = V[uV] / R[ohm] = raw * 10 * 1000 / R[mohm] */
    int32_t current_ua = ((int32_t)shunt * 10000) / (int32_t)JL_SHUNT_MILLIOHM;
    uint16_t bus_mv = (uint16_t)((bus_raw >> 3) * 4u);
    send_packet(JL_PKT_MEASUREMENT, (uint32_t)current_ua, bus_mv, seq);
    s_samples_done++;
    if (++s_since_sync >= JL_TIME_SYNC_EVERY) {
        s_since_sync = 0;
        send_packet(JL_PKT_TIME_SYNC, t, (uint16_t)JL_SAMPLE_PERIOD_US, seq);
    }
}

void jl_on_i2c_error(I2C_HandleTypeDef *hi2c)
{
    if (hi2c != s_i2c) return;
    s_last_i2c_error = HAL_I2C_GetError(hi2c);
    s_i2c_busy = 0;
    s_i2c_fail_total++;
    s_consecutive_fail++;
}

/* ---- markers ---- */
void jl_function_start(uint16_t id) { send_packet(JL_PKT_FUNC_START, jl_now_us(), id, s_last_seq); }
void jl_function_end(uint16_t id)   { send_packet(JL_PKT_FUNC_END, jl_now_us(), id, s_last_seq); }

void jl_on_gpio_edge(uint16_t pin)
{
    uint32_t t = jl_now_us();
    uint8_t ch;
    GPIO_PinState level;
    if (pin == GPIO_PIN_0) { ch = 0; level = HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0); }
    else if (pin == GPIO_PIN_1) { ch = 1; level = HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_1); }
    else return;
    send_packet(JL_PKT_GPIO_EDGE, t, (uint16_t)((ch << 8) | (level == GPIO_PIN_SET ? 1u : 0u)), s_last_seq);
}

uint8_t jl_sensor_ok(void) { return s_sensor_ok; }

/* ---- lifecycle ---- */
void jl_init(UART_HandleTypeDef *uart, I2C_HandleTypeDef *i2c, TIM_HandleTypeDef *clock_tim,
             TIM_HandleTypeDef *sample_tim)
{
    s_uart = uart;
    s_i2c = i2c;
    s_clock_tim = clock_tim;
    s_sample_tim = sample_tim;
}

void jl_start(void)
{
    HAL_TIM_Base_Start(s_clock_tim);
    send_packet(JL_PKT_HELLO, JL_PROTOCOL_MAGIC, 0, 0);
    if (ina219_configure() == HAL_OK) {
        s_sensor_ok = 1;
    } else {
        send_packet(JL_PKT_DEVICE_STATUS, HAL_I2C_GetError(s_i2c), JL_ST_INA219_NOT_FOUND, 0);
    }
    HAL_TIM_Base_Start_IT(s_sample_tim);
}

void jl_poll(void)
{
    static uint32_t last_hello, last_status, last_probe;
    static uint32_t rep_i2c, rep_overrun, rep_tx, rep_ovf;
    uint32_t now = HAL_GetTick();

    if (now - last_hello >= JL_HELLO_INTERVAL_MS) {
        last_hello = now;
        send_packet(JL_PKT_HELLO, JL_PROTOCOL_MAGIC, 0, s_last_seq);
    }

    /* Sensor lost: stop starting reads and try to bring it back once a second. */
    if (s_sensor_ok && s_consecutive_fail >= SENSOR_LOST_AFTER) {
        s_sensor_ok = 0;
        send_packet(JL_PKT_DEVICE_STATUS, s_last_i2c_error, JL_ST_INA219_NOT_FOUND, s_last_seq);
    }
    if (!s_sensor_ok && now - last_probe >= 1000u) {
        last_probe = now;
        HAL_I2C_DeInit(s_i2c);                   /* clears a stuck bus state */
        HAL_I2C_Init(s_i2c);
        if (ina219_configure() == HAL_OK) {
            s_consecutive_fail = 0;
            s_i2c_busy = 0;
            s_sensor_ok = 1;
            send_packet(JL_PKT_DEVICE_STATUS, 0, JL_ST_INA219_RECOVERED, s_last_seq);
        } else {
            send_packet(JL_PKT_DEVICE_STATUS, HAL_I2C_GetError(s_i2c), JL_ST_INA219_NOT_FOUND, s_last_seq);
        }
        HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);   /* LD2 blinks while the INA219 is missing */
    }

    if (now - last_status >= JL_STATUS_INTERVAL_MS) {
        last_status = now;
        if (s_i2c_fail_total != rep_i2c) {
            rep_i2c = s_i2c_fail_total;
            send_packet(JL_PKT_DEVICE_STATUS, s_last_i2c_error, JL_ST_I2C_READ_FAILED, s_last_seq);
        }
        if (s_overrun_total != rep_overrun) {
            rep_overrun = s_overrun_total;
            send_packet(JL_PKT_DEVICE_STATUS, rep_overrun, JL_ST_SAMPLE_OVERRUN, s_last_seq);
        }
        if (s_overflow_total != rep_ovf) {
            rep_ovf = s_overflow_total;     /* individual overflows were already reported per sample */
        }
        if (s_tx_dropped != rep_tx) {
            rep_tx = s_tx_dropped;
            send_packet(JL_PKT_DEVICE_STATUS, rep_tx, JL_ST_TX_OVERFLOW, s_last_seq);
        }
    }
}
