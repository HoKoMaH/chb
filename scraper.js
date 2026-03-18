const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * 1. إعداد مصفوفة المفاتيح من متغيرات البيئة (Render)
 * تأكد من إضافة GEMINI_KEY_1 إلى GEMINI_KEY_7 في إعدادات الموقع
 */
const keys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k); // استخدام المفاتيح المتوفرة فقط

let currentKeyIndex = 0;

/**
 * دالة اختيار المفتاح التالي بالتناوب لضمان عدم تجاوز الـ Rate Limit
 */
function getNextModel() {
    if (keys.length === 0) {
        throw new Error("❌ لم يتم العثور على أي مفاتيح Gemini في إعدادات السيرفر!");
    }
    const key = keys[currentKeyIndex];
    // الانتقال للمفتاح التالي في الطلب القادم
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

/**
 * دالة الترجمة باستخدام Gemini مع معالجة الأخطاء
 */
async function translateWithGemini(textBatch, retryCount = 0) {
    if (!textBatch || textBatch.length === 0) return [];
    
    const model = getNextModel();
    const prompt = `Translate these subtitle lines to Arabic. 
    Return ONLY a plain JSON array of strings. 
    No formatting, no code blocks, no intro.
    Lines: ${JSON.stringify(textBatch)}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();
        
        // تنظيف النص من أي زوائد Markdown
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const parsed = JSON.parse(text);
        
        // التحقق من صحة عدد الأسطر المترجمة
        if (Array.isArray(parsed) && parsed.length === textBatch.length) {
            return parsed;
        } else {
            console.warn(`[WARN] اختلاف في عدد الأسطر، سيتم استخدام الأصل لهذه الدفعة.`);
            return textBatch;
        }
    } catch (e) {
        console.error(`[KEY-ERROR] مفتاح رقم ${currentKeyIndex + 1} فشل: ${e.message}`);
        
        // محاولة إعادة الطلب بمفتاح آخر إذا فشل الأول (مرة واحدة فقط)
        if (retryCount < 1) {
            console.log("🔄 محاولة الترجمة بمفتاح بديل...");
            return await translateWithGemini(textBatch, retryCount + 1);
        }
        return textBatch;
    }
}

/**
 * المحرك الرئيسي المتصل بـ index.js
 */
async function translateToArabic(sourceSrt, onProgress = () => {}) {
    if (!sourceSrt) return "";

    // تقسيم الملف واستخراج النصوص فقط
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // تجاهل الأرقام والتوقيت والأسطر الفارغة
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const totalLines = textToTranslate.length;
    if (totalLines === 0) return sourceSrt;

    // حجم الدفعة (40 سطر) - مثالي مع نظام 7 مفاتيح
    const BATCH_SIZE = 40; 
    let finalResults = [];

    for (let i = 0; i < totalLines; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        
        const translatedBatch = await translateWithGemini(batch);
        finalResults.push(...translatedBatch);

        // إرسال النسبة المئوية للمتصفح
        const percent = Math.floor(((i + batch.length) / totalLines) * 100);
        if (onProgress) onProgress(percent);
        
        // تأخير بسيط (300ms) لضمان استقرار البث
        await new Promise(r => setTimeout(r, 300)); 
    }

    // دمج النصوص المترجمة في هيكل الـ SRT الأصلي
    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }

    return lines.join('\n');
}

/**
 * جلب الملفات من Subdl (كما هي)
 */
async function fetchAllPossibleSubs(fullId) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && season !== 'undefined') url += `&season=${season}&episode=${episode}`;

        const res = await axios.get(url);
        const sub = res.data.subtitles?.find(s => s.lang === 'english') || res.data.subtitles?.[0];
        
        if (!sub) return [];

        const content = await downloadAndUnzip(sub.url);
        if (content) {
            // الترجمة التلقائية عند الإضافة لأول مرة
            const translatedContent = await translateToArabic(content);
            return [{
                content: translatedContent,
                releaseName: sub.release_name,
                source: "Gemini AI (Multi-Key)"
            }];
        }
    } catch (e) { console.error("Fetcher Error:", e.message); }
    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.startsWith('__MACOSX'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
