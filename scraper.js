const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x');

// إعداد مفاتيح Gemini (تأكد من إضافتها في Render)
const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * 1. البحث في OpenSubtitles (باستخدام فكرة المستودع الذي أرسلته)
 */
async function fetchFromOpenSubs(imdbId, lang = 'ara') {
    try {
        // ملاحظة: OpenSubtitles يتطلب User-Agent أو API Key في النسخ الجديدة
        // هنا نستخدم البحث المباشر عن طريق الـ ID
        const response = await axios.get(`https://rest.opensubtitles.org/search/imdbid-${imdbId}/sublanguageid-${lang}`, {
            headers: { 'User-Agent': 'TemporaryUserAgent' }
        });
        
        if (response.data && response.data.length > 0) {
            const sub = response.data[0];
            const downloadRes = await axios.get(sub.SubDownloadLink, { responseType: 'arraybuffer' });
            // فك الضغط إذا كان بصيغة gz أو zip
            const content = sub.SubDownloadLink.endsWith('.gz') 
                ? require('zlib').gunzipSync(Buffer.from(downloadRes.data)).toString('utf-8')
                : downloadRes.data.toString('utf-8');
            
            return { content, label: sub.MovieReleaseName || sub.SubFileName };
        }
    } catch (e) {
        console.error("OpenSubs Error:", e.message);
    }
    return null;
}

/**
 * 2. محرك الترجمة النفاث (Parallel AI)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const BATCH_SIZE = 45; // حجم دفعة أكبر للسرعة
    let allPromises = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const key = keys[Math.floor(i / BATCH_SIZE) % keys.length];
        
        allPromises.push((async () => {
            try {
                if (!key) throw new Error();
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(`Translate to Arabic JSON array: ${JSON.stringify(batch)}`);
                const text = (await result.response).text().trim().replace(/```json/g, '').replace(/```/g, '');
                return JSON.parse(text);
            } catch {
                const res = await translate(batch, { to: 'ar', forceBatch: true });
                return res.map(item => item.text);
            }
        })());
    }

    const results = await Promise.all(allPromises);
    const finalResults = [].concat(...results);

    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }
    return lines.join('\n');
}

/**
 * 3. الدالة المركزية الذكية (Smart Engine)
 */
async function getSmartSubtitles(fullId, SubtitleModel) {
    const imdbIdOnly = fullId.split(':')[0].replace('tt', '');

    // أولوية 1: البحث عن ترجمة عربية جاهزة في OpenSubtitles
    const osArabic = await fetchFromOpenSubs(imdbIdOnly, 'ara');
    if (osArabic) return [{ content: osArabic.content, label: osArabic.label, isAI: false }];

    // أولوية 2: البحث في قاعدة بياناتك (MongoDB)
    const localSubs = await SubtitleModel.find({ imdbId: fullId });
    if (localSubs.length > 0) return localSubs.map(s => ({ content: s.arabicText, label: s.label, isAI: s.isAI }));

    // أولوية 3: سحب ترجمة إنجليزية وتعريبها فوراً
    const osEnglish = await fetchFromOpenSubs(imdbIdOnly, 'eng');
    if (osEnglish) {
        const translated = await translateToArabic(osEnglish.content);
        
        // حفظ في القاعدة للسرعة مستقبلاً
        const fileId = `${fullId.replace(/:/g, '_')}_ai_${Date.now()}`;
        await SubtitleModel.create({
            fileId: fileId,
            imdbId: fullId,
            arabicText: translated,
            label: osEnglish.label,
            isAI: true
        });

        return [{ content: translated, label: osEnglish.label, isAI: true }];
    }

    return [];
}

module.exports = { getSmartSubtitles };
