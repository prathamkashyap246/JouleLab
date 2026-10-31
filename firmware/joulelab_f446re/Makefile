# JouleLab firmware for NUCLEO-F446RE.
#   make            -> build/joulelab_f446re.elf / .hex / .bin
#   make flash      -> flash with STM32_Programmer_CLI (STM32CubeProgrammer) or st-flash
#   make clean
TARGET   = joulelab_f446re
BUILD    = build
PREFIX  ?= arm-none-eabi-
CC       = $(PREFIX)gcc
AS       = $(PREFIX)gcc -x assembler-with-cpp
OBJCOPY  = $(PREFIX)objcopy
SIZE     = $(PREFIX)size

HAL = Drivers/STM32F4xx_HAL_Driver/Src
C_SOURCES = \
  Core/Src/main.c Core/Src/joulelab.c Core/Src/jl_protocol.c Core/Src/stm32f4xx_it.c \
  Core/Src/stm32f4xx_hal_msp.c Core/Src/system_stm32f4xx.c \
  $(HAL)/stm32f4xx_hal.c $(HAL)/stm32f4xx_hal_cortex.c $(HAL)/stm32f4xx_hal_rcc.c $(HAL)/stm32f4xx_hal_rcc_ex.c \
  $(HAL)/stm32f4xx_hal_gpio.c $(HAL)/stm32f4xx_hal_uart.c $(HAL)/stm32f4xx_hal_i2c.c $(HAL)/stm32f4xx_hal_i2c_ex.c \
  $(HAL)/stm32f4xx_hal_tim.c $(HAL)/stm32f4xx_hal_tim_ex.c $(HAL)/stm32f4xx_hal_dma.c $(HAL)/stm32f4xx_hal_dma_ex.c \
  $(HAL)/stm32f4xx_hal_pwr.c $(HAL)/stm32f4xx_hal_pwr_ex.c $(HAL)/stm32f4xx_hal_flash.c $(HAL)/stm32f4xx_hal_flash_ex.c \
  $(HAL)/stm32f4xx_hal_flash_ramfunc.c $(HAL)/stm32f4xx_hal_exti.c
ASM_SOURCES = startup_stm32f446xx.s

MCU  = -mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard
DEFS = -DUSE_HAL_DRIVER -DSTM32F446xx
INCS = -ICore/Inc -IDrivers/STM32F4xx_HAL_Driver/Inc -IDrivers/CMSIS/Device/ST/STM32F4xx/Include -IDrivers/CMSIS/Include
CFLAGS  = $(MCU) $(DEFS) $(INCS) -Os -g3 -std=gnu11 -Wall -Wextra -Wno-unused-parameter -fdata-sections -ffunction-sections
LDFLAGS = $(MCU) -specs=nano.specs -TSTM32F446RETX_FLASH.ld -Wl,--gc-sections \
          -Wl,-Map=$(BUILD)/$(TARGET).map,--cref -Wl,--no-warn-rwx-segments -lc -lm

OBJECTS  = $(addprefix $(BUILD)/,$(notdir $(C_SOURCES:.c=.o)) $(notdir $(ASM_SOURCES:.s=.o)))
vpath %.c $(sort $(dir $(C_SOURCES)))
vpath %.s $(sort $(dir $(ASM_SOURCES)))

all: $(BUILD)/$(TARGET).elf $(BUILD)/$(TARGET).hex $(BUILD)/$(TARGET).bin

$(BUILD)/%.o: %.c Makefile Core/Inc/jl_config.h | $(BUILD)
	$(CC) -c $(CFLAGS) $< -o $@
$(BUILD)/%.o: %.s Makefile | $(BUILD)
	$(AS) -c $(MCU) $< -o $@
$(BUILD)/$(TARGET).elf: $(OBJECTS)
	$(CC) $(OBJECTS) $(LDFLAGS) -o $@
	$(SIZE) $@
$(BUILD)/%.hex: $(BUILD)/%.elf
	$(OBJCOPY) -O ihex $< $@
$(BUILD)/%.bin: $(BUILD)/%.elf
	$(OBJCOPY) -O binary -S $< $@
$(BUILD):
	mkdir -p $@

flash: $(BUILD)/$(TARGET).bin
	@if command -v STM32_Programmer_CLI >/dev/null 2>&1; then \
	  STM32_Programmer_CLI -c port=SWD -w $(BUILD)/$(TARGET).bin 0x08000000 -v -rst; \
	elif command -v st-flash >/dev/null 2>&1; then \
	  st-flash --reset write $(BUILD)/$(TARGET).bin 0x08000000; \
	else echo "Install STM32CubeProgrammer or stlink (st-flash), or copy $(BUILD)/$(TARGET).bin onto the NOD_F446RE USB drive."; exit 1; fi

clean:
	rm -rf $(BUILD)

.PHONY: all flash clean
