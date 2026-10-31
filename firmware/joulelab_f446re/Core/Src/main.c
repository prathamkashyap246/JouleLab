/*
 * JouleLab firmware for NUCLEO-F446RE.
 *
 * Peripherals (same names/settings as STM32CubeMX would generate):
 *   SYSCLK 84 MHz from HSI 16 MHz via PLL (M=16, N=336, P=4), APB1 42 MHz, APB2 84 MHz
 *   USART2  PA2 TX / PA3 RX, 115200 8N1, no flow control  -> ST-LINK virtual COM port
 *   I2C1    PB8 SCL (D15) / PB9 SDA (D14), 400 kHz         -> INA219
 *   TIM2    1 MHz free-running 32-bit counter (timestamps)
 *   TIM3    update interrupt every JL_SAMPLE_PERIOD_US (sampling)
 *   PA0/PA1 (A0/A1) EXTI rising+falling, pull-down          -> GPIO marker inputs
 *   PA5     LD2 user LED
 */
#include "main.h"
#include "joulelab.h"

UART_HandleTypeDef huart2;
I2C_HandleTypeDef hi2c1;
TIM_HandleTypeDef htim2;
TIM_HandleTypeDef htim3;

static void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART2_UART_Init(void);
static void MX_I2C1_Init(void);
static void MX_TIM2_Init(void);
static void MX_TIM3_Init(void);

#if JL_DEMO_WORKLOAD
/* Example firmware to profile. Each phase draws a different, real current
 * that the INA219 measures when it sits across the IDD jumper (JP6). */
static volatile float s_sink;

static void busy_us(uint32_t us)
{
    uint32_t start = jl_now_us();
    while ((uint32_t)(jl_now_us() - start) < us) { __NOP(); }
}

static void sensor_read(void)      /* 20 ms: CPU busy, like polling a sensor */
{
    busy_us(20000);
}

static void compute(void)          /* 50 ms: floating-point work */
{
    uint32_t start = jl_now_us();
    float acc = 0.0f;
    while ((uint32_t)(jl_now_us() - start) < 50000u) {
        for (int i = 1; i < 64; i++) acc += 1.0f / (float)i * acc + 0.5f;
    }
    s_sink = acc;
}

static void send_data(void)        /* 30 ms: LED on (extra load) while busy */
{
    /* While the INA219 is missing, LD2 is left to jl_poll(), which blinks it slowly as an error sign. */
    uint8_t led = jl_sensor_ok();
    if (led) HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);
    busy_us(30000);
    if (led) HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
}

static void idle_sleep(void)       /* 100 ms: sleep mode, woken only by interrupts */
{
    uint32_t start = jl_now_us();
    while ((uint32_t)(jl_now_us() - start) < 100000u) { __WFI(); }
}
#endif

int main(void)
{
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();
    MX_USART2_UART_Init();
    MX_I2C1_Init();
    MX_TIM2_Init();
    MX_TIM3_Init();

    jl_init(&huart2, &hi2c1, &htim2, &htim3);
    jl_start();

    while (1) {
        jl_poll();
#if JL_DEMO_WORKLOAD
        JL_FUNCTION_START(JL_FN_SENSOR_READ); sensor_read(); JL_FUNCTION_END(JL_FN_SENSOR_READ);
        jl_poll();
        JL_FUNCTION_START(JL_FN_COMPUTE);     compute();     JL_FUNCTION_END(JL_FN_COMPUTE);
        jl_poll();
        JL_FUNCTION_START(JL_FN_SEND_DATA);   send_data();   JL_FUNCTION_END(JL_FN_SEND_DATA);
        jl_poll();
        JL_FUNCTION_START(JL_FN_IDLE_SLEEP);  idle_sleep();  JL_FUNCTION_END(JL_FN_IDLE_SLEEP);
#endif
    }
}

/* ---- HAL callbacks -> JouleLab ---- */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) { jl_on_timer(htim); }
void HAL_I2C_MemRxCpltCallback(I2C_HandleTypeDef *hi2c)    { jl_on_i2c_rx_done(hi2c); }
void HAL_I2C_ErrorCallback(I2C_HandleTypeDef *hi2c)        { jl_on_i2c_error(hi2c); }
void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart)    { jl_on_uart_tx_done(huart); }
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)             { jl_on_gpio_edge(GPIO_Pin); }

/* ---- init ---- */
static void SystemClock_Config(void)
{
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};

    __HAL_RCC_PWR_CLK_ENABLE();
    __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE3); /* valid up to 120 MHz */

    osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
    osc.HSIState = RCC_HSI_ON;
    osc.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSI;
    osc.PLL.PLLM = 16;
    osc.PLL.PLLN = 336;
    osc.PLL.PLLP = RCC_PLLP_DIV4;
    osc.PLL.PLLQ = 7;
    osc.PLL.PLLR = 2;
    if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();

    clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
    clk.APB1CLKDivider = RCC_HCLK_DIV2;
    clk.APB2CLKDivider = RCC_HCLK_DIV1;
    if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) Error_Handler();
}

static void MX_USART2_UART_Init(void)
{
    huart2.Instance = USART2;
    huart2.Init.BaudRate = 115200;
    huart2.Init.WordLength = UART_WORDLENGTH_8B;
    huart2.Init.StopBits = UART_STOPBITS_1;
    huart2.Init.Parity = UART_PARITY_NONE;
    huart2.Init.Mode = UART_MODE_TX_RX;
    huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
    huart2.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart2) != HAL_OK) Error_Handler();
}

static void MX_I2C1_Init(void)
{
    hi2c1.Instance = I2C1;
    hi2c1.Init.ClockSpeed = 400000;
    hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
    hi2c1.Init.OwnAddress1 = 0;
    hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
    hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
    hi2c1.Init.OwnAddress2 = 0;
    hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
    hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
    if (HAL_I2C_Init(&hi2c1) != HAL_OK) Error_Handler();
}

static void MX_TIM2_Init(void) /* 84 MHz / 84 = 1 MHz, 32-bit free running */
{
    htim2.Instance = TIM2;
    htim2.Init.Prescaler = 84 - 1;
    htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim2.Init.Period = 0xFFFFFFFFu;
    htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
    htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
    if (HAL_TIM_Base_Init(&htim2) != HAL_OK) Error_Handler();
}

static void MX_TIM3_Init(void) /* 1 MHz tick, update every JL_SAMPLE_PERIOD_US */
{
    htim3.Instance = TIM3;
    htim3.Init.Prescaler = 84 - 1;
    htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim3.Init.Period = JL_SAMPLE_PERIOD_US - 1u;
    htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
    htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;
    if (HAL_TIM_Base_Init(&htim3) != HAL_OK) Error_Handler();
}

static void MX_GPIO_Init(void)
{
    GPIO_InitTypeDef g = {0};
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
    g.Pin = GPIO_PIN_5;                       /* LD2 */
    g.Mode = GPIO_MODE_OUTPUT_PP;
    g.Pull = GPIO_NOPULL;
    g.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(GPIOA, &g);

    g.Pin = GPIO_PIN_0 | GPIO_PIN_1;          /* A0 / A1: marker inputs from an external device */
    g.Mode = GPIO_MODE_IT_RISING_FALLING;
    g.Pull = GPIO_PULLDOWN;
    HAL_GPIO_Init(GPIOA, &g);

    HAL_NVIC_SetPriority(EXTI0_IRQn, 0, 0);   /* highest: edge timestamps must be precise */
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);
    HAL_NVIC_SetPriority(EXTI1_IRQn, 0, 0);
    HAL_NVIC_EnableIRQ(EXTI1_IRQn);
}

void Error_Handler(void)
{
    __disable_irq();
    while (1) {
        /* fast LD2 blink = init failure */
        HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);
        for (volatile uint32_t i = 0; i < 400000u; i++) { }
    }
}

#ifdef USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line) { (void)file; (void)line; Error_Handler(); }
#endif
