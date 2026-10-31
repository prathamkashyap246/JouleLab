// STM32 NUCLEO-F446RE (Arduino framework): serial output check. No peripherals needed.
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("STM32 started");
}

void loop() {
  Serial.println("Hello from STM32");
  delay(1000);
}
