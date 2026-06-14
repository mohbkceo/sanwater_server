const mongoose = require( 'mongoose');

const PhoneSchema = new mongoose.Schema(
  {
    label: String,
    number: String,
  },
  { _id: false }
);

const ContactSectionSchema = new mongoose.Schema(
  {
    region: String,

    companies: [String],

    phones: [PhoneSchema],

    address: String,

    maps: String,

    gradient: String,
  },
  { _id: false }
);

const SalesSchema = new mongoose.Schema(
  {
    title: String,

    phones: [String],
  },
  { _id: false }
);

const PageContentSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
    },

    mainTitle: String,

    subTitle: String,

    logo: String,

    contactSections: [ContactSectionSchema],

    salesData: [SalesSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('PageContent', PageContentSchema);