// JouleLab example for ESP32 DevKit.
// GPIO 4 is HIGH while "work" runs. Wire GPIO 4 -> NUCLEO A0 (PA0) and GND -> GND, and power the
// ESP32 through the INA219, to get GPIO-timed energy per call in the JouleLab "Live hardware" tab.
const int MARKER_PIN = 4;
const int LED_PIN = 2;   // on-board LED of most ESP32 DevKit boards

void work() {
  digitalWrite(MARKER_PIN, HIGH);
  digitalWrite(LED_PIN, HIGH);
  unsigned long start = millis();
  volatile float x = 0;
  while (millis() - start < 50) x += 1.0f / (x + 1.0f);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(MARKER_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(MARKER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("JouleLab ESP32 example started");
}

void loop() {
  work();
  Serial.println("work() done");
  delay(450);
}
