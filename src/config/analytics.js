const BROWSER_EVENTS = Object.freeze([
  'page_viewed', 'product_viewed', 'product_inquiry_started', 'lead_form_started',
  'job_viewed', 'job_apply_clicked', 'article_viewed', 'article_product_clicked',
  'article_contact_clicked', 'article_reading_progress',
]);
const BUSINESS_EVENTS = Object.freeze([
  'product_created', 'product_updated', 'product_published', 'product_archived', 'product_price_changed',
  'lead_created', 'lead_contacted', 'lead_qualified', 'quote_sent', 'lead_won', 'lead_lost', 'lead_assigned',
  'quotation_submitted', 'quotation_under_review', 'quotation_quoted', 'quotation_negotiation',
  'quotation_approved', 'quotation_rejected', 'quotation_closed', 'quotation_assigned',
  'job_created', 'job_published', 'job_closed',
  'article_created', 'article_submitted_for_review', 'article_published', 'article_archived', 'article_restored',
  'application_submitted', 'application_stage_changed',
]);
const SUBJECT_TYPES = Object.freeze(['product', 'product_family', 'lead', 'quotation', 'hiring_position', 'application', 'article', 'campaign', 'admin_user']);
const PERSONAS = Object.freeze(['executive', 'product_manager', 'marketing_manager', 'sales_manager', 'hiring_manager', 'content_manager', 'operations_manager', 'general_admin']);
const LEGACY_BROWSER_EVENTS = Object.freeze({
  page_view: 'page_viewed', product_view: 'product_viewed', article_view: 'article_viewed',
  product_inquiry_started: 'product_inquiry_started', lead_form_started: 'lead_form_started',
  article_product_clicked: 'article_product_clicked', article_contact_clicked: 'article_contact_clicked',
});
module.exports = { BROWSER_EVENTS, BUSINESS_EVENTS, SUBJECT_TYPES, PERSONAS, LEGACY_BROWSER_EVENTS };
