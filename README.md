# IoT Activity Tracker

Kompleksowy system monitorowania aktywności fizycznej oparty na mikrokontrolerze ESP32 oraz aplikacji mobilnej stworzonej w technologii React Native. Urządzenie pełni funkcję "Holtera", rejestrując parametry ruchu w czasie rzeczywistym i klasyfikując stany (Spoczynek, Chód, Bieg).

## 🚀 Funkcje
- **Monitorowanie Live:** Wizualizacja wskaźnika SVM i statusu aktywności w aplikacji przez BLE.
- **Autonomiczna Rejestracja:** Zapis danych pomiarowych na kartę MicroSD z precyzyjnym znacznikiem czasu (RTC).
- **Inteligentna Klasyfikacja:** Autorski algorytm bazujący na dynamice ruchu i detekcji pików.
- **Analiza Historyczna:** Możliwość bezprzewodowego pobrania fragmentów historii z karty SD do aplikacji.

## 🛠 Struktura Projektu
- `/RejestratorFirmware`: Kod C++ dla ESP32 (środowisko PlatformIO).
- `/RejestratorAplikacja`: Kod aplikacji mobilnej (React Native / Expo).

## 📟 Hardware
- **ESP32 DevKit V1** (Dwurdzeniowy mikrokontroler z Bluetooth)
- **MPU-9250** (9-osiowy akcelerometr/żyroskop/magnetometr)
- **DS3231** (Precyzyjny zegar czasu rzeczywistego RTC)
- **Moduł MicroSD** (Archiwizacja danych w formacie CSV)

## 📱 Technologie
- **Firmware:** C++, Arduino Framework, PlatformIO.
- **Mobile:** JavaScript, React Native, Expo, BLE PLX.
- **Protokoły:** I2C (Sensory), SPI (SD Card), BLE (Transmisja bezprzewodowa).

## 📐 Algorytmika
Klasyfikacja opiera się na wektorze wypadkowym przyspieszenia (SVM):
$$SVM = \sqrt{a_x^2 + a_y^2 + a_z^2}$$
Zastosowano filtrację składowej stałej (grawitacji) oraz analizę statystyczną w oknach czasowych 3.5s.