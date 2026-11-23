const News = require('../../models/news.model');
const { publicOrigin, escape } = require('../../services/newsMetadata');

const generateSitemap = async (req, res, next) => {
    try {
        const news = await News.find({
            $or: [
                { status: 'published' },
                { status: 'scheduled', publishedAt: { $lte: new Date() } }
            ]
        }).select('slug updatedAt');

        const baseUrl = publicOrigin(true);
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        
        // Main pages
        const mainPages = ['', '/products', '/about', '/contact-sales', '/news'];
        mainPages.forEach(page => {
            xml += `
            <url>
                <loc>${escape(baseUrl + page)}</loc>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
            </url>`;
        });

        // News articles
        news.forEach(article => {
            xml += `
            <url>
                <loc>${escape(`${baseUrl}/news/${encodeURIComponent(article.slug)}`)}</loc>
                <lastmod>${article.updatedAt.toISOString().split('T')[0]}</lastmod>
                <changefreq>monthly</changefreq>
                <priority>0.6</priority>
            </url>`;
        });

        xml += '</urlset>';

        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);
    } catch (err) {
        next(err);
    }
};

module.exports = { generateSitemap };
