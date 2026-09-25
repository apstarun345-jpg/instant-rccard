# 📖 GV Partner Dashboard & Tag Mapping Guide (हिंदी में)

यह गाइड आपको **GV Partner Dashboard** और नए **Tag Mapping (टैग मैपिंग)** फीचर को उपयोग करने और Netlify पर लाइव करने की पूरी जानकारी देती है।

---

## 🚀 मुख्य फीचर्स (Key Features)

1. **Tag Mapping (टैग मैपिंग - NEW)**:
   - Excel (`.xlsx`, `.xls`) या CSV फाइल अपलोड करके टैग्स को Google Sheet में बल्क मैप करें।
   - Auto Column Detection: `TAG_ID`, `SERIAL_NUMBER`, `AGENT_ID`, `AGENT_NAME`, `VEHICLE_CLASS` अपने आप पहचान लेता है।
   - Duplicate Handling: पहले से मौजूद टैग्स को स्किप या अपडेट करने का विकल्प।
   - Live Progress Bar और विस्तृत स्टेटस लॉग (सफलता, फेल, डुप्लीकेट)।
   - परिणाम (Results) को Excel में एक्सपोर्ट करने की सुविधा।
   - Single Tag Quick Mapping: बिना फाइल के तुरंत एक टैग मैप करने का फॉर्म।
   - Sample Excel Template: 1-क्लिक में डाउनलोड करने योग्य टेम्पलेट।

2. **Dashboard Overview**:
   - Total Agents, Active Agents, Total Issuance, VC4 Share, Today Issued, Month Target।
   - Vehicle Class Distribution Donut Chart।
   - Top 10 Agents Leaderboard।

3. **Tag Assignment**:
   - लाइव टैग इन्वेंट्री और सर्च।

4. **API Settings**:
   - Google Apps Script Web App URL सेट करें और "Test Connection" से तुरंत स्टेटस चेक करें।

---

## 🛠️ भाग 1: Google Sheet & Apps Script Setup

1. [Google Sheets](https://sheets.new) पर एक नई खाली शीट बनाएं। उसका नाम रखें: **GV Partner Master**.
2. ऊपर मेनू में जाएं: **Extensions > Apps Script**.
3. एडिटर में जो कोड पहले से है उसे हटा दें, और `TagMapping-AppsScript.gs` का पूरा कोड पेस्ट करें।
4. ऊपर **Save (💾)** बटन दबाएं।
5. ऊपर दाईं ओर **Deploy > New deployment** पर क्लिक करें:
   - Select type: **Web app**
   - Description: `Tag Mapping V4`
   - Execute as: **Me (apna email)**
   - Who has access: **Anyone** (महत्वपूर्ण!)
6. **Deploy** दबाएं। फिर **Authorize access** देकर अपना गूगल अकाउंट चुनें (Advanced > Go to Untitled project (unsafe) > Allow)।
7. आपको एक **Web App URL** मिलेगा (जैसे `https://script.google.com/macros/s/AKfycb.../exec`).
8. इस URL को कॉपी कर लें!

---

## 🌐 भाग 2: Dashboard में API URL जोड़ना

1. GV Partner Dashboard खोलें।
2. बाईं तरफ (Left Sidebar) में **⚙️ API Settings** पर जाएं।
3. **Google Apps Script Web App URL** वाले बॉक्स में अपना URL पेस्ट करें।
4. **Save & Test Connection** बटन दबाएं।
5. "🟢 Connected Successfully" का मैसेज आएगा और सेटअप मोड से लाइव मोड में बदल जाएगा!

---

## 🏷️ भाग 3: Tag Mapping (Excel Upload) कैसे करें

1. बाईं तरफ मेनू में **🗺️ Tag Mapping** पर क्लिक करें।
2. अगर आपके पास सैंपल टेम्पलेट नहीं है, तो **📥 Download Sample Excel Template** दबाकर टेम्पलेट डाउनलोड करें।
3. अपनी Excel फाइल (`.xlsx` या `.csv`) को ड्रैग एंड ड्रॉप करें या **Choose File** दबाकर चुनें।
4. नीचे **Column Mapping Preview** में चेक करें कि Tag ID, Serial Number, Agent Name सही मैच हुए हैं।
5. **🚀 Start Tag Mapping** बटन दबाएं।
6. स्क्रीन पर लाइव प्रोग्रेस बार चलेगी और हर टैग का स्टेटस (Success / Duplicate / Failed) दिखेगा।
7. काम पूरा होने के बाद **⬇️ Export Results to Excel** दबाकर रिजल्ट डाउनलोड कर सकते हैं।
8. अपनी Google Sheet खोलकर देखें — वहां **Tag_Mapping** नाम की नई शीट में सारा डेटा सही कॉलम्स के साथ जुड़ चुका होगा!

---

## ☁️ भाग 4: Netlify पर Deploy कैसे करें

1. [Netlify Drop](https://app.netlify.com/drop) खोलें (या Netlify Dashboard में जाएं)।
2. `gv-partner-dashboard` फोल्डर को सीधे ड्रैग करके Netlify Drop पर छोड़ दें।
3. 30 सेकंड में आपकी वेबसाइट लाइव हो जाएगी और आपको Netlify का लाइव URL मिल जाएगा!
