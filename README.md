# IoT Activity Tracker

A comprehensive physical activity monitoring system based on the **ESP32** microcontroller and a **React Native** mobile application. The device acts as a "Holter" monitor, recording movement parameters in real-time and classifying user states (Rest, Walking, Running).

## 🚀 Key Features
- **Real-time Live Monitoring:** Low-latency visualization of SVM (Signal Vector Magnitude) and activity status via Bluetooth Low Energy (BLE).
- **Autonomous Data Logging:** Reliable recording of raw and processed sensor data to a MicroSD card with precise timestamps (DS3231 RTC).
- **Intelligent Activity Classification:** On-device algorithm using dynamic thresholds and peak detection to identify movement types.
- **Wireless History Sync:** Ability to fetch and synchronize historical data segments from the SD card directly to the mobile app.

## 📸 Overview

| Home Page | History Analytics | Hardware Schematic |
| :---: | :---: | :---: |
| <img src="docs/screenshots/activity-tracker.PNG" width="250"> | <img src="docs/screenshots/activity-tracker2.PNG" width="250"> | <img src="docs/screenshots/activity-tracker3.png" width="250"> |

## 🛠 Project Structure
- `/RejestratorFirmware`: C++ Firmware for ESP32 (PlatformIO / Arduino Framework).
- `/RejestratorAplikacja`: Mobile Application (React Native / Expo).

## 📟 Hardware Specifications
- **Microcontroller:** ESP32 DevKit V1 (Dual-core, Integrated BLE/Wi-Fi).
- **IMU Sensor:** MPU-9250 (9-axis accelerometer, gyroscope, and magnetometer).
- **Clock:** DS3231 (Extremely accurate I2C Real-Time Clock).
- **Storage:** MicroSD Card Module (FAT32 file system for CSV logging).

## 📱 Technology Stack
- **Firmware:** C++, Arduino Core, PlatformIO IDE.
- **Mobile:** JavaScript/ES6, React Native, Expo, BLE PLX.
- **Communication Protocols:**
  - **I2C:** Sensor & RTC communication.
  - **SPI:** High-speed SD Card interface.
  - **BLE (GATT):** Wireless data transfer using custom Service/Characteristic profiles.

## 📐 Signal Processing & Algorithm
The activity classification is based on the **Signal Vector Magnitude (SVM)**, which ensures orientation-independent measurements:

$$SVM = \sqrt{a_x^2 + a_y^2 + a_z^2}$$

The system employs a digital **Low-Pass Filter** to isolate gravity components and analyzes data within **3.5s time windows** to determine movement intensity and frequency.

## 🔧 Installation & Setup
1. **Firmware:** Open `/RejestratorFirmware` in VS Code with PlatformIO and upload to ESP32.
2. **Mobile App:** - Navigate to `/RejestratorAplikacja`.
   - Run `npm install` to fetch dependencies.
   - Run `npx expo start` to launch the development server.