#include "main.h"

/* Interrupt priorities (0 = highest). SysTick is 0 (TICK_INT_PRIORITY) so HAL timeouts work everywhere. */
#define PRIO_I2C   1
#define PRIO_TIM3  2
#define PRIO_UART  3

void HAL_MspInit(void)
{
    __HAL_RCC_SYSCFG_CLK_ENABLE();
    __HAL_RCC_PWR_CLK_ENABLE();
    HAL_NVIC_SetPriorityGrouping(NVIC_PRIORITYGROUP_4);
}

void HAL_UART_MspInit(UART_HandleTypeDef *huart)
{
    if (huart->Instance != USART2) return;
    GPIO_InitTypeDef g = {0};
    __HAL_RCC_USART2_CLK_ENABLE();
    __HAL_RCC_GPIOA_CLK_ENABLE();
    g.Pin = GPIO_PIN_2 | GPIO_PIN_3;          /* PA2 = USART2_TX, PA3 = USART2_RX (wired to ST-LINK VCP) */
    g.Mode = GPIO_MODE_AF_PP;
    g.Pull = GPIO_NOPULL;
    g.Speed = GPIO_SPEED_FREQ_VERY_HIGH;
    g.Alternate = GPIO_AF7_USART2;
    HAL_GPIO_Init(GPIOA, &g);
    HAL_NVIC_SetPriority(USART2_IRQn, PRIO_UART, 0);
    HAL_NVIC_EnableIRQ(USART2_IRQn);
}

void HAL_I2C_MspInit(I2C_HandleTypeDef *hi2c)
{
    if (hi2c->Instance != I2C1) return;
    GPIO_InitTypeDef g = {0};
    __HAL_RCC_GPIOB_CLK_ENABLE();
    g.Pin = GPIO_PIN_8 | GPIO_PIN_9;          /* PB8 = I2C1_SCL (D15), PB9 = I2C1_SDA (D14) */
    g.Mode = GPIO_MODE_AF_OD;
    g.Pull = GPIO_PULLUP;                     /* weak; INA219 breakouts have 10k pull-ups */
    g.Speed = GPIO_SPEED_FREQ_VERY_HIGH;
    g.Alternate = GPIO_AF4_I2C1;
    HAL_GPIO_Init(GPIOB, &g);
    __HAL_RCC_I2C1_CLK_ENABLE();
    HAL_NVIC_SetPriority(I2C1_EV_IRQn, PRIO_I2C, 0);
    HAL_NVIC_EnableIRQ(I2C1_EV_IRQn);
    HAL_NVIC_SetPriority(I2C1_ER_IRQn, PRIO_I2C, 0);
    HAL_NVIC_EnableIRQ(I2C1_ER_IRQn);
}

void HAL_I2C_MspDeInit(I2C_HandleTypeDef *hi2c)
{
    if (hi2c->Instance != I2C1) return;
    __HAL_RCC_I2C1_FORCE_RESET();             /* also clears a stuck BUSY flag */
    __HAL_RCC_I2C1_RELEASE_RESET();
    __HAL_RCC_I2C1_CLK_DISABLE();
    HAL_GPIO_DeInit(GPIOB, GPIO_PIN_8 | GPIO_PIN_9);
    HAL_NVIC_DisableIRQ(I2C1_EV_IRQn);
    HAL_NVIC_DisableIRQ(I2C1_ER_IRQn);
}

void HAL_TIM_Base_MspInit(TIM_HandleTypeDef *htim)
{
    if (htim->Instance == TIM2) {
        __HAL_RCC_TIM2_CLK_ENABLE();
    } else if (htim->Instance == TIM3) {
        __HAL_RCC_TIM3_CLK_ENABLE();
        HAL_NVIC_SetPriority(TIM3_IRQn, PRIO_TIM3, 0);
        HAL_NVIC_EnableIRQ(TIM3_IRQn);
    }
}
