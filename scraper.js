const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x');

// إعدادات الوصول لمنع الحظر
const axiosHeader = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * 1. دالة التحميل وفك الضغط
 */
async function downloadAndUnzip(subUrl) {
    try {
        const fullUrl = subUrl.startsWith('http') ? subUrl : `https://dl.subdl.com${subUrl}`;
        const res = await axios.get(fullUrl, { 
            responseType: 'arraybuffer', 
            headers: axiosHeader,
            timeout: 20000 
        });
        
        const zip = new AdmZip(Buffer.from(res.data));
        const entries = zip.getEntries();
        
        const srtEntry = entries.find(e => 
            e.entryName.toLowerCase().endsWith('.srt') && 
            !e.entryName.includes('MACOSX') &&
            !e.entryName.startsWith('.')
        );
        
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        console.error(`[ZIP-ERROR] ❌ فشل التحميل: ${subUrl}`, err.message);
        return null;
    }
}

/**
 * 2. محرك الترجمة (Gemini + Fallback)
 */
async function translateToArabic(sourceSrt, onProgress = null) {
    if (!sourceSrt) return "";
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [], mapIndices = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const BATCH_SIZE = 45; 
    let completed = 0;
    const total = Math.ceil(textToTranslate.length / BATCH_SIZE);
    let allPromises = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const key = keys[Math.floor(i / BATCH_SIZE) % keys.length];
        
        allPromises.push((async () => {
            try {
                const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: "gemini-1.5-flash" });
                const prompt = `Translate to Arabic. Return JSON array only: ${JSON.stringify(batch)}`;
                const result = await model.generateContent(prompt);
                let text = (await result.response).text().trim().replace(/```json/g, '').replace(/```/g, '');
                const parsed = JSON.parse(text);
                completed++;
                if (onProgress) onProgress(Math.round((completed / total) * 100));
                return Array.isArray(parsed) ? parsed : batch;
            } catch {
                try {
                    const res = await translate(batch, { to: 'ar' });
                    completed++;
                    if (onProgress) onProgress(Math.round((completed / total) * 100));
                    return res.map(item => item.text);
                } catch {
                    completed++;
                    if (onProgress) onProgress(Math.round((completed / total) * 100));
                    return batch;
                }
            }
        })());
    }

    const results = await Promise.all(allPromises);
    const finalResults = [].concat(...results);
    for (let i = 0; i < mapIndices.length; i++) lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    return lines.join('\n');
}

/**
 * 3. المحرك الرئيسي (البحث، الحفظ، العرض)
 */
async function getSmartSubtitles(fullId, SubtitleModel) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const cleanId = fullId.startsWith('tt') ? fullId : `tt${fullId}`;
    const [imdbId, season, episode] = cleanId.split(':');
    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة 1: جلب وحفظ الترجمات العربية الأصلية
        console.log(`[SCRAPER] 🔍 جاري سحب الترجمات لـ ${cleanId}...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`, { headers: axiosHeader }).catch(() => null);
        
        if (arRes?.data?.status === true && arRes.data.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا ${arRes.data.subtitles.length} ملف. جاري المزامنة مع قاعدة البيانات...`);
            
            for (let s of arRes.data.subtitles.slice(0, 8)) {
                const content = await downloadAndUnzip(s.url);
                if (content) {
                    const uniqueFileId = `${cleanId.replace(/:/g,'_')}_org_${s.subs_id || Math.random().toString(36).substr(2, 5)}`;
                    
                    // الحفظ أو التحديث لضمان ظهورها في Stats
                    const savedSub = await SubtitleModel.findOneAndUpdate(
                        { fileId: uniqueFileId },
                        {
                            fileId: uniqueFileId,
                            imdbId: cleanId,
                            arabicText: content,
                            label: s.release_name || 'Original Arabic',
                            isAI: false
                        },
                        { upsert: true, new: true }
                    );
                    results.push(savedSub);
                }
            }
            if (results.length > 0) return results;
        }

        // المرحلة 2: البحث في المخزن المحلي (إذا لم نجد جديداً من SUBDL)
        const localSubs = await SubtitleModel.find({ imdbId: cleanId });
        if (localSubs.length > 0) return localSubs;

        // المرحلة 3: التعريب الآلي (إذا كان الفيلم جديداً تماماً ولا يوجد له ترجمة عربية)
        console.log(`[SCRAPER] 🌍 لا يوجد ملف عربي. جاري بدء التعريب الآلي...`);
        const enRes = await axios.get(`${baseUrl}&languages=en`, { headers: axiosHeader }).catch(() => null);
        
        if (enRes?.data?.subtitles?.length > 0) {
            const bestEn = enRes.data.subtitles[0];
            const sourceContent = await downloadAndUnzip(bestEn.url);
            
            if (sourceContent) {
                const translated = await translateToArabic(sourceContent);
                const fileId = `${cleanId.replace(/:/g, '_')}_ai_${Date.now()}`;
                
                const newSub = await SubtitleModel.create({
                    fileId: fileId,
                    imdbId: cleanId,
                    arabicText: translated,
                    label: bestEn.release_name,
                    isAI: true
                });
                return [newSub];
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR]:`, e.message);
    }
    return results;
}

module.exports = { getSmartSubtitles, translateToArabic };
