// JouleLab example for Arduino Uno R3.
// Pin 7 is HIGH while "work" runs. Wire pin 7 -> NUCLEO A0 (PA0) through a 5 V -> 3.3 V level
// shifter or divider (the NUCLEO input is 3.3 V), GND -> GND, and power the Uno through the INA219.
const int MARKER_PIN = 7;

void work() {
  digitalWrite(MARKER_PIN, HIGH);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(50);
  digitalWrite(LED_BUILTIN, LOW);
  digitalWrite(MARKER_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(MARKER_PIN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println(F("JouleLab Uno example started"));
}

void loop() {
  work();
  Serial.println(F("work() done"));
  delay(450);
}
