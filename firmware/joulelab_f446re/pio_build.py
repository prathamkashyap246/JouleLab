# PlatformIO pre-build script: same MCU/FPU/link flags as the Makefile (hard-float Cortex-M4F,
# newlib-nano). Flags that disagree with the project's own startup/linker files are removed first.
Import("env")  # noqa: F821  (provided by PlatformIO/SCons)

MCU = ["-mcpu=cortex-m4", "-mthumb", "-mfpu=fpv4-sp-d16", "-mfloat-abi=hard"]

# The bare ststm32 platform may add its own float-ABI flag; two different ones make the linker
# refuse to mix objects ("uses VFP register arguments, ... does not").
for key in ("CCFLAGS", "ASFLAGS", "LINKFLAGS"):
    kept = [f for f in env.get(key, []) if not str(f).startswith(("-mfloat-abi", "-mfpu"))]  # noqa: F821
    env.Replace(**{key: kept})  # noqa: F821

env.Append(  # noqa: F821
    CCFLAGS=MCU + ["-fdata-sections", "-ffunction-sections", "-Wall"],
    ASFLAGS=MCU,
    LINKFLAGS=MCU + ["-Wl,--gc-sections", "-specs=nano.specs"],
    LIBS=["c", "m"],
)
