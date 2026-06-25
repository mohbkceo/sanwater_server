const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true
    },
    excerpt: {
        type: String,
        trim: true
    },
    content: {
        type: String,
        required: [true, 'Content is required']
    },
    coverImage: {
        type: String,
        default: null
    },
    category: {
        type: String,
        trim: true,
        default: 'General'
    },
    tags: {
        type: [String],
        default: []
    },
    author: {
        type: String,
        required: [true, 'Author is required']
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'scheduled'],
        default: 'draft'
    },
    publishedAt: {
        type: Date,
        default: null
    },
    seoTitle: {
        type: String,
        trim: true
    },
    seoDescription: {
        type: String,
        trim: true
    },
    canonicalUrl: {
        type: String,
        trim: true
    },
    isFeatured: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Index for search
newsSchema.index({ title: 'text', excerpt: 'text', content: 'text', tags: 'text' });

// Simple slugify function since we don't want to add new libraries if possible
function generateSlug(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')     // Replace spaces with -
        .replace(/[^\w-]+/g, '')  // Remove all non-word chars
        .replace(/--+/g, '-');    // Replace multiple - with single -
}

// Auto-generate slug before saving
newsSchema.pre('save', async function(next) {
    if (this.isModified('title') || !this.slug) {
        let baseSlug = generateSlug(this.title);
        let slug = baseSlug;
        let counter = 1;
        
        // Ensure slug is unique
        const News = mongoose.model('News');
        while (await News.findOne({ slug, _id: { $ne: this._id } })) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }
        this.slug = slug;
    }
    
    // Set publishedAt if status is published and not already set
    if (this.status === 'published' && !this.publishedAt) {
        this.publishedAt = new Date();
    }
    
    next();
});

const News = mongoose.model('News', newsSchema);

module.exports = News;
