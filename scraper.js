const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x');

// إعداد مفاتيح Gemini السبعة من بيئة Render
const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * 1. محرك البحث والجلب من SUBDL
 */
async function fetchFromSubdl(fullId, lang = 'arabic') {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}&languages=${lang}`;
        if (season && episode) url += `&season=${season}&episode=${episode}`;

        const res = await axios.get(url);
        const subs = res.data.subtitles || [];
        
        if (subs.length > 0) {
            // اختيار أول نتيجة (الأكثر مطابقة للنسخة)
            const sub = subs[0];
            const content = await downloadAndUnzip(sub.url);
            return content ? { content, releaseName: sub.release_name } : null;
        }
    } catch (e) {
        console.error(`[SUBDL] Error fetching ${lang}:`, e.message);
    }
    return null;
}

/**
 * 2. محرك الترجمة النفاث (Parallel Processing) باستخدام 7 مفاتيح
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    // استخراج النصوص فقط وتجنب التوقيت والأرقام
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const BATCH_SIZE = 40; 
    let allPromises = [];

    // توزيع الدفعات على المفاتيح السبعة في وقت واحد
    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const keyIndex = Math.floor(i / BATCH_SIZE) % keys.length;
        const key = keys[keyIndex];
        
        allPromises.push((async () => {
            try {
                if (!key) throw new Error("No Key Available");
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                
                const prompt = `Translate this JSON array to Arabic. Return ONLY the translated JSON array. No text before or after: ${JSON.stringify(batch)}`;
                const result = await model.generateContent(prompt);
                const text = (await result.response).text().trim().replace(/```json/g, '').replace(/```/g, '');
                
                const parsed = JSON.parse(text);
                return (Array.isArray(parsed) && parsed.length === batch.length) ? parsed : batch;
            } catch (err) {
                // في حال فشل الـ AI، نستخدم Google Translate كخيار طوارئ لضمان عدم توقف الحلقة
                try {
                    const res = await translate(batch, { to: 'ar', forceBatch: true });
                    return res.map(item => item.text);
                } catch {
                    return batch; // العودة للنص الأصلي كحل أخير
                }
            }
        })());
    }

    const results = await Promise.all(allPromises);
    const finalResults = [].concat(...results);

    // إعادة دمج النصوص المترجمة في الملف الأصلي
    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }
    return lines.join('\n');
}

/**
 * 3. الدالة الرئيسية التي يستدعيها addon.js
 */
async function getSmartSubtitles(fullId, SubtitleModel) {
    // الخطوة 1: ابحث عن ترجمة عربية جاهزة في SUBDL (الأسرع والأدق)
    const onlineArabic = await fetchFromSubdl(fullId, 'arabic');
    if (onlineArabic) {
        return [{ content: onlineArabic.content, label: onlineArabic.releaseName, isAI: false }];
    }

    // الخطوة 2: ابحث في قاعدة البيانات (ربما ترجمها الـ AI لشخص قبلك)
    const localSubs = await SubtitleModel.find({ imdbId: fullId });
    if (localSubs.length > 0) {
        return localSubs.map(s => ({ content: s.arabicText, label: s.label, isAI: s.isAI }));
    }

    // الخطوة 3: اسحب ترجمة إنجليزية من SUBDL وقم بتعريبها فوراً
    const onlineEnglish = await fetchFromSubdl(fullId, 'english');
    if (onlineEnglish) {
        const translated = await translateToArabic(onlineEnglish.content);
        
        // حفظ في قاعدة البيانات لتسريع الوصول في المرات القادمة
        const fileId = `${fullId.replace(/:/g, '_')}_ai_${Date.now()}`;
        await SubtitleModel.create({
            fileId: fileId,
            imdbId: fullId,
            arabicText: translated,
            label: onlineEnglish.releaseName,
            isAI: true
        });

        return [{ content: translated, label: onlineEnglish.releaseName, isAI: true }];
    }

    return [];
}

/**
 * دالة التحميل وفك الضغط
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('MACOSX'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch { return null; }
}

module.exports = { getSmartSubtitles };
