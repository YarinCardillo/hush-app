# E2E Encryption Bug Report

**Data**: 2026-02-11
**Stato**: NON FUNZIONANTE

---

## Problema Iniziale

L'E2E encryption non funziona: un utente senza chiave E2E (che entra solo con nome+password) vede gli stream in chiaro invece di video corrotto.

---

## Debug Effettuato

### Test 1: Verifica setup E2E
- ✅ Chiave E2E derivata correttamente (`[e2e] Key set for encryption`)
- ✅ Transform applicato al sender (`[e2e] Encryption active for video/audio`)
- ❌ Stream arriva in chiaro al client senza E2E

### Test 2: RTCRtpScriptTransform (worker-based)
- ✅ Worker inizializzato (`[e2e-worker] Transform initialized`)
- ✅ Pipeline configurata (`[e2e-worker] Pipeline setup complete`)
- ✅ Transform rimane attivo (`[e2e] Transform still active`)
- ❌ **I frame NON entrano mai nel worker** (nessun log "frames entered readable stream")
- **Risultato**: I frame passano senza essere trasformati → stream in chiaro

### Test 3: createEncodedStreams (legacy method)
- Forzato uso del metodo legacy con `forceLegacy = true`
- ❌ **Errore**: `InvalidStateError: Too late to create encoded streams`
- **Causa**: `createEncodedStreams()` viene chiamato DOPO che il producer ha già iniziato a inviare frame

### Test 4: Rimozione await
- Rimosso `await` da `applyEncryptionTransform()` per applicare transform immediatamente
- ❌ **Stesso errore**: "Too late to create encoded streams"
- **Causa**: La funzione ha un `await importCryptoKey()` interno che causa delay

---

## Root Cause

**RACE CONDITION tra mediasoup e Insertable Streams API:**

```javascript
// 1. Producer creato e INIZIA A INVIARE FRAME
const videoProducer = await sendTransportRef.current.produce({ track: videoTrack });

// 2. Transform applicato (troppo tardi!)
applyEncryptionTransform(videoProducer.rtpSender, key, 'video');
```

**Problema con RTCRtpScriptTransform:**
- Il transform viene impostato ma i frame **non vengono inoltrati al worker**
- Possibile bug di Chrome su macOS o conflitto con mediasoup

**Problema con createEncodedStreams:**
- Deve essere chiamato **PRIMA** che il producer inizi a inviare frame
- Nel nostro codice viene chiamato DOPO `produce()` → "Too late"

---

## Tentativi di Fix (tutti falliti)

1. ❌ Applicare transform con timing diversi
2. ❌ Usare metodo legacy invece di RTCRtpScriptTransform
3. ❌ Rimuovere await per applicazione immediata
4. ❌ Aggiungere logging per debug

---

## Soluzioni Possibili (da implementare)

### Opzione 1: Pre-importare chiave crypto
```javascript
// PRIMA di produce()
const encryptKey = await importCryptoKey(keyBytes, ['encrypt']);

// Poi produce()
const producer = await transport.produce({ track });

// Applica transform IMMEDIATAMENTE (sincrono)
const { readable, writable } = producer.rtpSender.createEncodedStreams();
// ... setup pipeline con encryptKey già pronto
```

### Opzione 2: Modificare mediasoup
Aggiungere opzione per ritardare l'invio di frame fino a quando il transform è pronto.

### Opzione 3: Hook in mediasoup
Usare un hook di mediasoup (se esiste) per applicare transform PRIMA dell'invio.

### Opzione 4: Investigare RTCRtpScriptTransform
Capire perché i frame non entrano nel worker. Possibili cause:
- Bug di Chrome
- Conflitto con mediasoup
- Problema nel setup del worker

### Opzione 5: Disabilitare temporaneamente E2E
Rimuovere feature fino a fix definitivo (DTLS/SRTP rimane attivo).

---

## File Coinvolti

- `client/src/lib/encryption.js` - Funzioni apply*Transform
- `client/src/lib/e2eWorker.js` - Worker per RTCRtpScriptTransform
- `client/src/hooks/useMediasoup.js` - Chiamate a applyEncryptionTransform (righe 436, 461, 588, 756)
- `client/src/pages/Room.jsx` - Derivazione chiave E2E

---

## Log di Debug Aggiunti (da rimuovere dopo fix)

```javascript
// e2eWorker.js
console.log('[e2e-worker] Transform initialized')
console.log('[e2e-worker] Pipeline setup complete')
console.log('[e2e-worker] ${count} frames entered readable stream')
console.log('[e2e-worker] Encrypted ${count} frames')

// encryption.js
console.log('[e2e] Transform still active for ${kind}')
```

---

## Risorse

- WebRTC Insertable Streams: https://developer.chrome.com/docs/capabilities/web-apis/insertable-streams
- RTCRtpScriptTransform: https://w3c.github.io/webrtc-encoded-transform/
- mediasoup Client API: https://mediasoup.org/documentation/v3/mediasoup-client/api/
