const axios = require('axios');
const AdmZip = require('adm-zip');
const { Perplexity } = require('perplexity-ai'); // استدعاء المكتبة

const pp_client = new Perplexity(process.env.PERPLEXITY_API_KEY);

async function translateWithAI(englishSrt) {
    console.log("[AI] 🤖 بدأت عملية الترجمة بالذكاء الاصطناعي...");
    
    // سنرسل أول 50 سطر فقط كمثال لضمان عدم تجاوز حدود الـ Token 
    // في المشاريع الكبيرة يفضل تقسيم الملف إلى أجزاء
    const prompt = `Translate this SRT subtitle content to natural Arabic. 
    Keep the timing format exactly as it is. Only return the translated SRT text:
    \n\n${englishSrt.slice(0, 5000)}`; // نأخذ جزءاً للتجربة

    try {
        const response = await pp_client.chat.create({
            model: "sonar-reasoning", // أو الموديل الذي تفضله
            messages: [{ role: "user", content: prompt }]
        });
        return response.choices[0].message.content;
    } catch (e) {
        console.error("[AI-ERROR] فشل Perplexity:", e.message);
        return null;
    }
}

async function fetchAllPossibleSubs(imdbId) {
    const API_KEY = process.env.SUBDL_API_KEY;
    let results = [];

    try {
        // 1. البحث عن ترجمة عربية أولاً
        let response = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=ar&api_key=${API_KEY}`);
        
        if (response.data.subtitles.length > 0) {
            results = await processSubDLResults(response.data.subtitles.slice(0, 3));
        }

        // 2. إذا لم نجد عربية، نبحث عن إنجليزية ونترجمها!
        if (results.length === 0) {
            console.log("[SCRAPER] ⚠️ لا يوجد ترجمة عربية. جاري البحث عن إنجليزية لترجمتها بالذكاء الاصطناعي...");
            let enResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=en&api_key=${API_KEY}`);
            
            if (enResponse.data.subtitles.length > 0) {
                const enSub = enResponse.data.subtitles[0];
                const enSrt = await downloadAndUnzip(enSub.url);
                
                if (enSrt) {
                    const arSrt = await translateWithAI(enSrt);
                    if (arSrt) {
                        results.push({
                            content: arSrt,
                            releaseName: `${enSub.release_name} (AI Translated)`,
                            source: "Perplexity AI"
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error("Scraper Error:", e.message);
    }
    return results;
}

// دالة مساعدة لتحميل وفك الضغط
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srt = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srt ? srt.getData().toString('utf8') : null;
    } catch { return null; }
}

module.exports = { fetchAllPossibleSubs };
