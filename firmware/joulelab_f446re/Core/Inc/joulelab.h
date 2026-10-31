/*
 * JouleLab measurement firmware for NUCLEO-F446RE + INA219.
 *
 *   TIM2  free-running 32-bit counter at 1 MHz  -> jl_now_us(), packet timestamps
 *   TIM3  update interrupt every JL_SAMPLE_PERIOD_US -> starts one INA219 sample
 *   I2C1  interrupt-driven reads of INA219 shunt + bus registers (non-blocking)
 *   USART2 (ST-LINK virtual COM port) interrupt-driven TX from a ring buffer
 *   EXTI0/1 on PA0/PA1 -> GPIO_EDGE packets (markers from an external device)
 *
 * Hook these into the HAL callbacks (main.c does this already):
 *   HAL_TIM_PeriodElapsedCallback -> jl_on_timer
 *   HAL_I2C_MemRxCpltCallback      -> jl_on_i2c_rx_done
 *   HAL_I2C_ErrorCallback          -> jl_on_i2c_error
 *   HAL_UART_TxCpltCallback        -> jl_on_uart_tx_done
 *   HAL_GPIO_EXTI_Callback         -> jl_on_gpio_edge
 */
#ifndef JOULELAB_H
#define JOULELAB_H

#include <stdint.h>
#include "stm32f4xx_hal.h"
#include "jl_config.h"

void jl_init(UART_HandleTypeDef *uart, I2C_HandleTypeDef *i2c, TIM_HandleTypeDef *clock_tim,
             TIM_HandleTypeDef *sample_tim);
void jl_start(void);   /* probe INA219, send HELLO, start sampling */
void jl_poll(void);    /* call from the main loop at least every ~100 ms */
uint8_t jl_sensor_ok(void); /* 1 while the INA219 is answering */

static inline uint32_t jl_now_us(void) { return TIM2->CNT; }

/* Firmware-reported function markers (code running on THIS STM32). */
void jl_function_start(uint16_t function_id);
void jl_function_end(uint16_t function_id);
#define JL_FUNCTION_START(id) jl_function_start(id)
#define JL_FUNCTION_END(id)   jl_function_end(id)

/* HAL callback hooks */
void jl_on_timer(TIM_HandleTypeDef *htim);
void jl_on_i2c_rx_done(I2C_HandleTypeDef *hi2c);
void jl_on_i2c_error(I2C_HandleTypeDef *hi2c);
void jl_on_uart_tx_done(UART_HandleTypeDef *huart);
void jl_on_gpio_edge(uint16_t pin);

#endif /* JOULELAB_H */
