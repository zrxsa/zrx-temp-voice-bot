# 🎙️ Temporary Voice Channels Bot (بوت الرومات الصوتية المؤقتة)

بوت ديسكورد متكامل لإدارة الرومات الصوتية المؤقتة مبني على **`discord.js v14`** و **`SQLite (WAL)`** و **`Express`**، يدعم نظام الوضع المزدوج (رومات خاصة بالمالك بلوحة تحكم 15 زراً + رومات عامة متسلسلة تلقائياً)، مع أرشفة كاملة للأحداث والمحادثات (**HTML Transcripts**) ولوحة تحكم ويب مباشرة (**Web Dashboard**).  
جميع النصوص وتذييل الرسائل (`embedFooter`) والعناوين والإيموجيات قابلة للتعديل أو الإزالة بحرية كاملة من ملف `config.json`.

---

## ✨ المميزات الرئيسية

1. **الوضع المزدوج لقنوات الإنشاء (Dual-Mode Creator Channels):**
   - **رومات خاصة بالمالك (`owned`):** ينشئ روم صوتي باسم العضو مع لوحة تحكم تفاعلية من 15 زراً (تغيير الاسم، الحد الأقصى، الخصوصية، القفل/الفتح، الإخفاء/الإظهار، قفل الشات، غرفة الانتظار، الحالة Topic، المنطقة الجغرافية، طرد، دعوة، حظر/فك حظر، منح/سحب الثقة، نقل/المطالبة بالملكية، وحذف الروم).
   - **رومات عامة متسلسلة (`public`):** ينشئ رومات عامة بترقيم تلقائي متسلسل (`1`, `2`, `3`...).
2. **نظام الأرشفة التفاعلية (`HTML Transcripts`):**
   - يسجل جميع الرسائل والمرفقات وأحداث الانضمام والمغادرة والتنقل وإجراءات التحكم، ويرسل ملف HTML تفاعلياً بتصميم ديسكورد مع البحث والتصفية عبر **Webhook** أو قناة اللوق عند إغلاق الروم.
3. **لوحة تحكم ويب مباشرة (`Web Dashboard`):**
   - تعمل تلقائياً على `http://localhost:6767` لمتابعة الإحصائيات وإدارة الرومات النشطة وقنوات الماستر وسجلات الأحداث في الوقت الفعلي.
4. **حماية ضد التوقف وتعارض الأحداث:**
   - معالجة أخطاء Gateway وWebSocket وSQLite وRate Limits مع أقفال تزامن (`Concurrency Locks`) وحماية ضد حد تغيير أسماء القنوات في ديسكورد.
5. **تخصيص كامل من `config.json`:**
   - تعديل نص الفوتر (`embedFooter` — الافتراضي `zrx`) أو تركه `""` لإخفائه، وتعديل العناوين والألوان والمنفذ وجميع إيموجيات الأزرار الـ 15 بسهولة (تعمل بإيموجيات Unicode قياسية افتراضياً ويمكن استبدالها بآيديات إيموجيات مخصصة من سيرفرك).

---

## 📁 هيكلية المشروع

```text
├── index.js                 # نقطة الانطلاق وتشغيل البوت
├── config.json              # إعدادات الواجهة والحقوق والإيموجيات (قابلة للتعديل بالكامل)
├── .env.example             # نموذج ملف متغيرات البيئة (التوكن والآيدي والويب هوك)
├── image.png                # صورة دليل أزرار لوحة التحكم داخل الروم
├── run.bat                  # سكربت تشغيل تلقائي لويندوز
├── public/                  # واجهة لوحة التحكم الويب (HTML / CSS / JS)
└── src/
    ├── config/              # clientOptions.js, botConfig.js
    ├── components/          # controlPanel.js (لوحة التحكم بـ 15 زراً)
    ├── database/            # database.js (SQLite WAL)
    ├── events/              # ready, voiceStateUpdate, messageCreate, interactionCreate, channelDelete
    ├── handlers/            # commandHandler, buttonHandler, modalHandler, selectMenuHandler
    ├── server/              # dashboardServer.js (Express API & Web UI)
    ├── services/            # voiceService, cacheService, htmlGenerator
    └── utils/               # permissions.js
```

---

## ⚙️ متطلبات التشغيل

1. تثبيت **Node.js `18.0.0`** أو أحدث.
2. إنشاء تطبيق وبوت من [Discord Developer Portal](https://discord.com/developers/applications).
3. تفعيل الـ **Privileged Gateway Intents** التالية:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
4. منح البوت صلاحيات `Manage Channels` و `Move Members` و `Connect` و `Send Messages` و `Embed Links` و `Attach Files` (أو `Administrator`).

---

## 🛠️ خطوات الإعداد والتشغيل

### 1. تثبيت الحزم

```bash
npm install
```

### 2. إعداد ملف البيئة (`.env`)

انسخ `.env.example` إلى `.env` وضع بيانات بوتك:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
CLIENT_ID=YOUR_BOT_CLIENT_ID_HERE
PORT=6767
LOG_WEBHOOK_URL=
LOG_CHANNEL_ID=
```

> ⚠️ **تنبيه أمني:** لا ترفع ملف `.env` أبداً على GitHub (مضاف تلقائياً في `.gitignore`). يتم إنشاء قاعدة البيانات `temp_voice.db` تلقائياً عند أول تشغيل.

### 3. تخصيص ملف `config.json`

افتح [config.json](config.json) وعدّل أي إعداد بحرية:

| المفتاح | الوصف |
| :--- | :--- |
| `embedFooter` | النص الظاهر أسفل رسائل الإيمبد والأرشيف ولوحة الويب (الافتراضي: `"zrx"` — يمكنك تغييره أو تركه `""` لإخفائه تماماً) |
| `panelTitle` | عنوان لوحة التحكم داخل الروم الصوتي |
| `panelDescription` | النص الترحيبي داخل لوحة التحكم |
| `panelColor` | لون رسائل الإيمبد بصيغة Hex (مثال: `#2B2D31`) |
| `dashboardTitle` | اسم المشروع الظاهر في لوحة التحكم الويب |
| `dashboardPort` | منفذ لوحة التحكم الويب الافتراضي (`6767` — يتجاوزه متغير `PORT` في `.env` إن وُجد) |
| `buttonEmojis` | إيموجيات الأزرار الـ 15 (تقبل إيموجي Unicode عادي مثل `"📝"` أو آيدي إيموجي مخصص من سيرفرك) |

### 4. تشغيل البوت

- **عبر الأوامر:**
  ```bash
  npm start
  ```
- **على ويندوز (مع إعادة تشغيل تلقائية):** شغّل ملف `run.bat`.
- بعد التشغيل، افتح لوحة التحكم الويب من المتصفح على: `http://localhost:6767`.

---

## 🎮 الأوامر المتاحة

| الأمر | الصلاحية | الوصف |
| :--- | :--- | :--- |
| `/setup-temp-voice` | Manage Channels | تعيين قناة صوتية كقناة إنشاء (`owned` أو `public`) مع قالب اسم اختياري ورابط Webhook |
| `/set-temp-webhook` | Manage Channels | تعيين أو تغيير رابط Webhook لإرسال سجلات وأرشيف الرومات المؤقتة |

---

## ⚠️ حل مشكلة `DiscordAPIError[60003]: Two factor is required for this operation`

إذا ظهر الخطأ `60003` عند إنشاء روم صوتي، فهذا بسبب تفعيل خيار **"Require 2FA for moderator actions"** في السيرفر:
- **الحل الأول (الموصى به):** فعّل **التحقق بخطوتين (2FA / Authenticator App)** على حساب مالك البوت في Discord Developer Portal.
- **الحل الثاني:** من إعدادات السيرفر ⬅️ **Safety Setup / Moderation** ⬅️ أوقف خيار **Require 2FA for moderator actions**.

---

## 📜 الترخيص

مشروع مفتوح المصدر بترخيص **MIT** — بواسطة **zrx** (قابل للتعديل والاستخدام الحر بالكامل).
