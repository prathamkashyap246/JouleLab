#ifndef MAIN_H
#define MAIN_H

#include "stm32f4xx_hal.h"

extern UART_HandleTypeDef huart2;
extern I2C_HandleTypeDef hi2c1;
extern TIM_HandleTypeDef htim2;
extern TIM_HandleTypeDef htim3;

void Error_Handler(void);

#endif /* MAIN_H */
