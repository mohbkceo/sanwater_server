const PageContent = require( '../../models/page_content.model');
const { logActivity, logUpdateActivity } = require('../../utils/logger');
const { buildEntityDetails } = require('../../utils/audit');

const getPageContent = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = await PageContent.findOne({ slug });

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found',
      });
    }

    res.status(200).json({
      success: true,
      data: page,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updatePageContent = async (req, res) => {
  try {
    const { slug } = req.params;
    const before = await PageContent.findOne({ slug }).lean();

    const updatedPage = await PageContent.findOneAndUpdate(
      { slug },
      req.body,
      {
        new: true,
        runValidators: true,
        upsert: true
      }
    );

    if (!updatedPage) {
      return res.status(404).json({
        success: false,
        message: 'Page not found',
      });
    }

    if (before) await logUpdateActivity(req, 'UPDATE', 'PageContent', updatedPage._id, before, updatedPage, `Updated page content ${slug}`);
    else await logActivity(req, 'CREATE', 'PageContent', updatedPage._id, buildEntityDetails('PageContent', updatedPage, `Created page content ${slug}`));

    res.status(200).json({
      success: true,
      data: updatedPage,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = { updatePageContent, getPageContent };
