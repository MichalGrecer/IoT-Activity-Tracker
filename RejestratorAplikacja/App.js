import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Button, PermissionsAndroid, Platform, LogBox, SafeAreaView, Dimensions, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { LineChart } from "react-native-chart-kit";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from 'expo-sharing';

LogBox.ignoreLogs(['btoa', 'virtualized', 'TRenderEngine']);

// --- KONFIGURACJA UUID (Zgodne z ESP32) ---
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c2c6110f0f00';
const LIVE_UUID    = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const HISTORY_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const COMMAND_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';

const SCREEN_WIDTH = Dimensions.get("window").width;

// Mapowanie: Tekst -> Liczba (dla wykresu)
const ACTIVITY_MAP = { 
  'SPOCZYNEK': 0, 
  'CHOD': 1, 
  'BIEG': 2, 
  '---': 0 
};

export default function App() {
  const [manager] = useState(new BleManager());
  const [device, setDevice] = useState(null);
  const [status, setStatus] = useState('Rozłączono');
  
  // --- DANE LIVE ---
  const [activity, setActivity] = useState('---');
  const [svmValue, setSvmValue] = useState(0);
  const [livePoints, setLivePoints] = useState(new Array(40).fill(0));
  
  // --- DANE HISTORII ---
  const [currentTab, setCurrentTab] = useState('live');
  const [isSyncing, setIsSyncing] = useState(false);
  const fullHistoryRef = useRef([]); 
  
  // Dane przetworzone do wykresów
  const [chartDataSVM, setChartDataSVM] = useState([0]);
  const [chartDataState, setChartDataState] = useState([0]);
  const [chartLabels, setChartLabels] = useState(["00:00"]);
  
  // Ref do robienia zrzutu ekranu
  const chartViewRef = useRef(); 

  // --- KOLORYSTYKA ---
  const getBackgroundColor = () => {
    switch (activity) {
      case 'SPOCZYNEK': return '#e8f5e9';
      case 'CHOD': return '#fff3e0';
      case 'BIEG': return '#ffebee';
      default: return '#f5f5f5';
    }
  };

  const getStatusColor = () => {
    switch (activity) {
      case 'SPOCZYNEK': return '#2e7d32';
      case 'CHOD': return '#ef6c00';
      case 'BIEG': return '#c62828';
      default: return '#9e9e9e';
    }
  };

  // --- UPRAWNIENIA (Android) ---
  useEffect(() => {
    if (Platform.OS === 'android') {
      PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  }, []);

  // --- FUNKCJA: UDOSTĘPNIANIE WYKRESU ---
  const shareChart = async () => {
    try {
      const uri = await captureRef(chartViewRef, {
        format: "jpg",
        quality: 0.8,
        result: "tmpfile" //Dla IOS musi być tmpfile
      });
      await Sharing.shareAsync(uri);
    } catch (error) {
      Alert.alert("Błąd", "Nie udało się udostępnić wykresu.");
    }
  };

  // --- FUNKCJA: WYSYŁANIE ROZKAZU (SYNC) ---
  const requestSync = async (minutes) => {
    if (!device) return;
    setIsSyncing(true);
    setStatus(`Pobieranie ${minutes} min...`);
    
    fullHistoryRef.current = []; 
    
    const command = `SYNC:${minutes}`;
    const commandBase64 = Buffer.from(command).toString('base64');
    
    try {
        await device.writeCharacteristicWithoutResponseForService(
            SERVICE_UUID, 
            COMMAND_UUID, 
            commandBase64
        );
    } catch (e) {
        setIsSyncing(false);
        setStatus("Błąd wysyłania");
    }
  };

  // --- FUNKCJA: PRZELICZANIE DANYCH DO WYKRESU ---
  const prepareCharts = () => {
    const data = fullHistoryRef.current;
    if (data.length < 2) return;

    // Downsampling: ograniczenie liczby punktów dla wydajności
    let step = 1;
    if (data.length > 600) step = Math.ceil(data.length / 600);
    
    const optimized = data.filter((_, i) => i % step === 0);

    setChartDataSVM(optimized.map(d => d.svm));
    setChartDataState(optimized.map(d => ACTIVITY_MAP[d.act] || 0));
    
    // Etykiety osi X (tylko co 6-ty punkt, żeby było czytelnie)
    setChartLabels(optimized.map((d, i) => {
        if (i % Math.ceil(optimized.length / 6) === 0) return d.time.substring(0, 5); 
        return "";
    }));
  };

  // Odśwież wykresy po wejściu w zakładkę
  useEffect(() => {
    if (currentTab === 'charts' && !isSyncing) prepareCharts();
  }, [currentTab, isSyncing]);

  // --- FUNKCJA: SKANOWANIE I ŁĄCZENIE ---
  const scanAndConnect = () => {
    if (device) {
        manager.cancelDeviceConnection(device.id);
        setDevice(null);
        setStatus("Rozłączono");
        setActivity("---");
        return;
    }

    setStatus('Skanowanie...');
    manager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) { setStatus('Błąd'); return; }

      if (scannedDevice && scannedDevice.name === 'Rejestrator Aktywnosci') {
        manager.stopDeviceScan();
        setStatus('Łączenie...');
        
        scannedDevice.connect()
          .then((dev) => {
            setDevice(dev);
            return dev.discoverAllServicesAndCharacteristics();
          })
          .then((dev) => {
            setStatus('Połączono');

            // 1. NASŁUCH HISTORII (Z KARTY SD)
            dev.monitorCharacteristicForService(SERVICE_UUID, HISTORY_UUID, (err, char) => {
                if (err) return;
                const raw = Buffer.from(char.value, 'base64').toString('utf8');
                
                // Jeśli odebrano "END" -> koniec synchronizacji
                if (raw.includes("END")) {
                    setIsSyncing(false);
                    setStatus("Synchronizacja zakończona");
                    prepareCharts(); 
                } else {
                    const parts = raw.split(',');
                    if (parts.length >= 3) {
                        let timeLabel = parts[0].split(' ')[1] || parts[0];
                        fullHistoryRef.current.push({
                            time: timeLabel,
                            svm: parseFloat(parts[1]),
                            act: parts[2].trim()
                        });
                    }
                }
            });

            // 2. NASŁUCH LIVE (NA BIEŻĄCO)
            dev.monitorCharacteristicForService(SERVICE_UUID, LIVE_UUID, (err, char) => {
                if (err) return;
                const raw = Buffer.from(char.value, 'base64').toString('utf8');
                const parts = raw.split(',');
                
                if (parts.length === 2) {
                    const val = parseFloat(parts[0]);
                    const act = parts[1];
                    setSvmValue(val);
                    setActivity(act);
                    
                    if (!isSyncing) setStatus('Połączono (Live)');

                    // Wykres Live
                    setLivePoints(prev => [...prev, val].slice(-30));
                    
                    // Dodawanie do historii w tle
                    const now = new Date();
                    const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
                    fullHistoryRef.current.push({ time: timeStr, svm: val, act: act });
                }
            });
          })
          .catch(() => setStatus('Błąd'));
      }
    });
  };

  // --- RENDEROWANIE EKRANU 1: LIVE ---
  const renderLiveTab = () => (
    <View style={styles.tabContent}>
        <View style={styles.card}><Text style={styles.cardLabel}>Status: {status}</Text></View>
        
        <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Sygnał na żywo (g)</Text>
            <LineChart
                data={{ datasets: [{ data: livePoints }] }}
                width={SCREEN_WIDTH - 40} height={180}
                withInnerLines={false} withDots={false} withOuterLines={false} withHorizontalLabels={false}
                chartConfig={chartConfig} bezier
                style={styles.chart}
            />
            <Text style={styles.liveValue}>{svmValue.toFixed(2)}</Text>
        </View>
        
        <View style={[styles.circle, { borderColor: getStatusColor() }]}>
            <Text 
                style={[styles.activityText, { color: getStatusColor() }]}
                numberOfLines={1} 
                adjustsFontSizeToFit 
                minimumFontScale={0.5}
            >
                {activity}
            </Text>
        </View>

        <Button title={device ? "Rozłącz" : "Połącz"} onPress={scanAndConnect} color={device ? "#d32f2f" : "#1976d2"} />
    </View>
  );

  // --- RENDEROWANIE EKRANU 2: HISTORIA ---
const contentWidth = Math.max(SCREEN_WIDTH - 20, chartDataSVM.length * 5);

  const renderHistoryTab = () => (
    <ScrollView style={styles.tabContent}>
        <Text style={styles.header}>Pobierz Historię z SD</Text>
        <Text style={styles.subHeader}>(Wybierz zakres czasu)</Text>

        <View style={styles.syncContainer}>
            <View style={styles.syncRow}>
                <TouchableOpacity style={styles.syncBtn} onPress={() => requestSync(1)} disabled={isSyncing || !device}><Text style={styles.btnText}>1 min</Text></TouchableOpacity>
                <TouchableOpacity style={styles.syncBtn} onPress={() => requestSync(10)} disabled={isSyncing || !device}><Text style={styles.btnText}>10 min</Text></TouchableOpacity>
                <TouchableOpacity style={styles.syncBtn} onPress={() => requestSync(60)} disabled={isSyncing || !device}><Text style={styles.btnText}>1 godz</Text></TouchableOpacity>
            </View>
            <View style={styles.syncRow}>
                <TouchableOpacity style={[styles.syncBtn, styles.midBtn]} onPress={() => requestSync(360)} disabled={isSyncing || !device}><Text style={styles.btnText}>6h</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.syncBtn, styles.midBtn]} onPress={() => requestSync(720)} disabled={isSyncing || !device}><Text style={styles.btnText}>12h</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.syncBtn, styles.midBtn]} onPress={() => requestSync(1440)} disabled={isSyncing || !device}><Text style={styles.btnText}>24h</Text></TouchableOpacity>
            </View>
        </View>

        {isSyncing && <ActivityIndicator size="large" color="#0000ff" />}

        {!isSyncing && (
            <View>
                <Text style={styles.sectionTitle}>Podgląd Wykresów (Przewiń w bok)</Text>
                
                {/* STRUKTURA:
                   1. ScrollView (pozwala przewijać palcem)
                   2. ViewShot (obejmuje CAŁĄ szerokość zawartości)
                   3. View (kontener z wykresami o pełnej szerokości)
                */}
                <ScrollView horizontal={true} showsHorizontalScrollIndicator={true} style={{marginVertical: 10}}>
                    <ViewShot ref={chartViewRef} options={{ format: "jpg", quality: 0.9 }} style={{backgroundColor: '#fff', padding: 10}}>
                        <View style={{width: contentWidth}}>
                            
                            <Text style={{fontSize: 16, fontWeight: 'bold', marginBottom: 10}}>1. Dynamika Ruchu (SVM)</Text>
                            <LineChart
                                data={{
                                    labels: chartLabels,
                                    datasets: [{ data: chartDataSVM.length > 0 ? chartDataSVM : [0] }]
                                }}
                                width={contentWidth} 
                                height={220}
                                yAxisLabel="" yAxisSuffix=" g"
                                chartConfig={chartConfig} bezier style={styles.chart}
                            />

                            <Text style={{fontSize: 16, fontWeight: 'bold', marginTop: 20, marginBottom: 10}}>2. Aktywność (Klasyfikacja)</Text>
                            <LineChart
                                data={{
                                    labels: chartLabels,
                                    datasets: [{ data: chartDataState.length > 0 ? chartDataState : [0] }]
                                }}
                                width={contentWidth} 
                                height={180}
                                fromZero={true}
                                segments={2}         
                                yAxisInterval={1}
                                formatYLabel={(yValue) => {
                                    const val = parseInt(yValue);
                                    if (val === 0) return 'Spocz';
                                    if (val === 1) return 'Chód';
                                    if (val === 2) return 'Bieg';
                                    return '';
                                }}
                                chartConfig={{
                                    ...chartConfig,
                                    color: (opacity = 1) => `rgba(25, 118, 210, ${opacity})`,
                                    propsForDots: { r: "0" },
                                    decimalPlaces: 0,
                                }}
                                style={styles.chart}
                            />
                        </View>
                    </ViewShot>
                </ScrollView>
            </View>
        )}
        
        {!isSyncing && chartDataSVM.length > 5 && (
            <View style={{marginTop: 20}}>
                <Button title="Pobierz/Wyślij Cały Wykres" onPress={shareChart} />
            </View>
        )}
        <View style={{height: 50}} />
    </ScrollView>
  );
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: getBackgroundColor() }]}>
      <View style={styles.topBar}><Text style={styles.appTitle}>HolterApp</Text></View>
      {currentTab === 'live' ? renderLiveTab() : renderHistoryTab()}
      <View style={styles.navBar}>
        <TouchableOpacity style={[styles.navBtn, currentTab === 'live' && styles.activeBtn]} onPress={() => setCurrentTab('live')}><Text style={styles.navText}>LIVE</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.navBtn, currentTab === 'charts' && styles.activeBtn]} onPress={() => setCurrentTab('charts')}><Text>HISTORIA</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const chartConfig = {
    backgroundGradientFrom: "#ffffff",
    backgroundGradientTo: "#ffffff",
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    decimalPlaces: 1,
    propsForDots: { r: "1" },
    style: { borderRadius: 16 }
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { padding: 15, alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  appTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  tabContent: { flex: 1, padding: 10 },
  
  // LIVE
  card: { marginBottom: 10, alignItems: 'center' },
  cardLabel: { fontSize: 14, color: '#666' },
  chartContainer: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 15, padding: 5, marginBottom: 15, width: '100%' },
  chartTitle: { fontSize: 12, color: '#555', marginTop: 5 },
  chart: { marginVertical: 8, borderRadius: 16 },
  liveValue: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  circle: { width: 160, height: 160, borderRadius: 80, borderWidth: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 15, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.6)' },
  activityText: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 5 },

  // HISTORIA
  header: { fontSize: 20, fontWeight: 'bold', marginTop: 5, textAlign: 'center' },
  subHeader: { fontSize: 12, color: '#666', marginBottom: 10, textAlign: 'center' },
  syncContainer: { width: '100%', marginBottom: 15 },
  syncRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  syncBtn: { backgroundColor: '#1976d2', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  midBtn: { backgroundColor: '#1565c0' }, // Ciemniejszy dla długich czasów
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  sectionTitle: { fontSize: 14, fontWeight: 'bold', marginTop: 10, marginLeft: 10, color: '#333' },
  
  // NAV
  navBar: { flexDirection: 'row', height: 60, borderTopWidth: 1, borderColor: '#ccc', backgroundColor: '#fff' },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  activeBtn: { borderTopWidth: 3, borderColor: '#1976d2', backgroundColor: '#f0f8ff' },
  navText: { fontWeight: 'bold' }
});