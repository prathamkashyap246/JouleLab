from app.services.ai_optimizer import number_lines, validate_optimized

ORIG = """#define SVC "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
void setup() { }
void loop() { delay(10); }
"""


def test_number_lines():
    assert number_lines("a\nb").splitlines()[1].endswith("| b")


def test_validate_accepts_good_code():
    assert validate_optimized(ORIG, ORIG.replace("delay(10)", "delay(500)")) == []


def test_validate_rejects_bad_code():
    bad = "```cpp\nvoid loop() { \n```"
    p = validate_optimized(ORIG, bad)
    assert any("fences" in x for x in p) and any("setup()" in x for x in p)
    assert any("UUID" in x for x in p) and any("unbalanced" in x for x in p)


def test_empty_optimized_is_allowed():
    assert validate_optimized(ORIG, "") == []
