# PlatformIO pre-build script: same MCU/FPU flags as the Makefile (hard-float Cortex-M4F).
Import("env")  # noqa: F821  (provided by PlatformIO/SCons)

MCU = ["-mcpu=cortex-m4", "-mthumb", "-mfpu=fpv4-sp-d16", "-mfloat-abi=hard"]
env.Append(  # noqa: F821
    CCFLAGS=MCU + ["-fdata-sections", "-ffunction-sections", "-Wall"],
    ASFLAGS=MCU,
    LINKFLAGS=MCU + ["-Wl,--gc-sections"],
)
