#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <FS.h>
#include "MPU9250.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "RTClib.h"

// ======================================================
// 1. KONFIGURACJA SPRZĘTU
// ======================================================
#define SD_CS    5
#define SD_SCK   18
#define SD_MISO  19
#define SD_MOSI  23
const char* logFileName = "/dane_holter.csv";

// ======================================================
// 2.WYNIKI KALIBRACJI
// ======================================================
float bias_ax = 0.226465;
float bias_ay = 0.309404;
float bias_az = -17.340845;
// ======================================================

// --- ZMIENNE ALGORYTMU ---
float smoothedSVM = 9.81; 
float sumDynamicMove = 0.0; 
int sampleCount = 0;        
int runningPeaks = 0; 
String globalStatus = "SPOCZYNEK"; 

// --- TIMERY ---
unsigned long lastAlgoTime = 0;
unsigned long lastSendTime = 0;

const int SAMPLE_RATE_MS = 50;     // Odczyt 20Hz
const int ALGO_RATE_MS   = 3500;   // Decyzja co 3.5s
const int SEND_RATE_MS   = 200;    // Wykres/Zapis co 0.2s

// --- STANY APLIKACJI ---
bool isSyncing = false;
volatile int pendingSyncMinutes = 0; 

// --- BLE ---
BLEServer* pServer = NULL;
BLECharacteristic* pLiveChar = NULL;
BLECharacteristic* pHistoryChar = NULL;
BLECharacteristic* pCommandChar = NULL;
bool deviceConnected = false;

// UUID
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c2c6110f0f00"
#define LIVE_UUID           "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define HISTORY_UUID        "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define COMMAND_UUID        "beb5483e-36e1-4688-b7f5-ea07361b26aa"

// --- OBIEKTY ---
MPU9250 mpu(Wire, 0x69); // Adres MPU
RTC_DS3231 rtc;          // Adres RTC (0x68)

// --- FUNKCJA ZAPISU ---
void appendFile(fs::FS &fs, const char * path, const char * message){
  File file = fs.open(path, FILE_APPEND);
  if(file){ file.print(message); file.close(); }
}

// --- FUNKCJA WYSYŁANIA HISTORII ---
void processSync() {
  if (pendingSyncMinutes <= 0) return;

  Serial.printf("BLE: Rozpoczynam synchronizację ostatnich %d minut...\n", pendingSyncMinutes);
  
  File file = SD.open(logFileName, FILE_READ);
  if (file) {
    size_t fileSize = file.size();
    size_t bytesToRead = pendingSyncMinutes * 10500; 
    
    if (fileSize > bytesToRead) {
      file.seek(fileSize - bytesToRead);
      file.readStringUntil('\n');
    } else {
      file.seek(0); 
    }

    while (file.available()) {
      if (!deviceConnected) break; 

      String line = file.readStringUntil('\n');
      if (line.length() > 5) {
         pHistoryChar->setValue(line.c_str());
         pHistoryChar->notify();
         delay(30);
      }
    }
    file.close();
  }
  
  delay(200); 
  pHistoryChar->setValue("END");
  pHistoryChar->notify();
  
  Serial.println("BLE: Wysłano END. Wznawiam LIVE.");
  pendingSyncMinutes = 0;
}

class CommandCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string value = pCharacteristic->getValue();
      if (value.length() > 0) {
        String command = String(value.c_str());
        Serial.print("BLE Komenda: "); Serial.println(command);

        if (command.startsWith("SYNC:")) {
            pendingSyncMinutes = command.substring(5).toInt();
        }
      }
    }
};

class ServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { deviceConnected = true; Serial.println("BLE: Połączono!"); }
    void onDisconnect(BLEServer* pServer) { deviceConnected = false; pServer->startAdvertising(); }
};

void setup() {
  Serial.begin(115200);
  
  // 1. SD
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, SPI)) {
    Serial.println("BŁĄD: Karta SD nie działa!");
  } else {
    if (!SD.exists(logFileName)) {
      File file = SD.open(logFileName, FILE_WRITE);
      if(file) { file.println("Data_Godzina,SVM,Stan"); file.close(); }
    }
  }

  // 2. I2C
  Wire.begin(21, 22);
  delay(500);
  if (!rtc.begin()) { Serial.println("BŁĄD: Brak RTC!"); }
  else {
    Serial.println("Zegar RTC OK!");
    if (rtc.lostPower()) {
        rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }
  if (!mpu.begin()) {
    Serial.println("BŁĄD: Nie wykryto MPU!");
    while (1) { delay(100); } 
  }
  
  mpu.setAccelRange(MPU9250::ACCEL_RANGE_8G);
  mpu.setGyroRange(MPU9250::GYRO_RANGE_500DPS);
  mpu.setDlpfBandwidth(MPU9250::DLPF_BANDWIDTH_20HZ);

  // 3. BLE
  BLEDevice::init("Rejestrator Aktywnosci");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);
  
  pLiveChar = pService->createCharacteristic(LIVE_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pLiveChar->addDescriptor(new BLE2902());

  pHistoryChar = pService->createCharacteristic(HISTORY_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pHistoryChar->addDescriptor(new BLE2902());

  pCommandChar = pService->createCharacteristic(
                                COMMAND_UUID, 
                                BLECharacteristic::PROPERTY_WRITE | 
                                BLECharacteristic::PROPERTY_WRITE_NR
                              );
  pCommandChar->setCallbacks(new CommandCallbacks());

  pService->start();
  BLEDevice::startAdvertising();
  
  Serial.println(">>> SYSTEM GOTOWY <<<");
}

void loop() {
  if (pendingSyncMinutes > 0) { processSync(); return; }

  mpu.readSensor();
  
  float accX = mpu.getAccelX_mss() - bias_ax;
  float accY = mpu.getAccelY_mss() - bias_ay;
  float accZ = mpu.getAccelZ_mss() - bias_az;
  double currentSVM = sqrt(pow(accX, 2) + pow(accY, 2) + pow(accZ, 2));
  
  float alpha = 0.05; 
  smoothedSVM = (alpha * currentSVM) + ((1.0 - alpha) * smoothedSVM);
  double instantDynamic = abs(currentSVM - smoothedSVM);

  sumDynamicMove += instantDynamic;
  sampleCount++;
  if (instantDynamic > 5.0) runningPeaks++;

  if (millis() - lastAlgoTime >= ALGO_RATE_MS) {
      double avgDynamic = sumDynamicMove / sampleCount;
      if (runningPeaks >= 3 || avgDynamic > 3.5) globalStatus = "BIEG";
      else if (avgDynamic >= 1.2) globalStatus = "CHOD";
      else globalStatus = "SPOCZYNEK";

      sumDynamicMove = 0; sampleCount = 0; runningPeaks = 0;
      lastAlgoTime = millis();
  }

  if (millis() - lastSendTime >= SEND_RATE_MS) {
      DateTime now = rtc.now();
      
      // Pakiet BLE: "12.55,CHOD"
      String blePacket = String(currentSVM, 2) + "," + globalStatus;
      
      if (deviceConnected) {
        pLiveChar->setValue(blePacket.c_str());
        pLiveChar->notify(); 
      }
      
      char timeStr[25];
      snprintf(timeStr, sizeof(timeStr), "%04d-%02d-%02d %02d:%02d:%02d", 
               now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second());
      
      String sdLine = String(timeStr) + "," + blePacket + "\n";
      appendFile(SD, logFileName, sdLine.c_str());
      lastSendTime = millis();
  }

  delay(SAMPLE_RATE_MS); 
}