const WEIGHTS = {
  'lead.won': 100, 'lead.lost': 85, 'product.price_changed': 80,
  'product.archived': 75, 'job.closed': 70, 'product.published': 55,
  'quotation.approved': 80, 'quotation.rejected': 70,
  'article.published': 50, 'admin_user.login': 5,
};
const PERSONA_DOMAINS = {
  product_manager: ['product'], marketing_manager: ['article', 'product'],
  sales_manager: ['lead', 'quotation'], hiring_manager: ['job', 'application'],
  content_manager: ['article'], operations_manager: ['lead', 'quotation', 'job'],
};
function priority(log, persona, now = new Date()) {
  const name = log.eventName || '';
  const domain = name.split('.')[0];
  const base = WEIGHTS[name] || (log.action === 'DELETE' ? 60 : log.action === 'CREATE' ? 35 : 20);
  const ageDays = Math.max(0, (now - new Date(log.createdAt)) / 86400000);
  const relevance = PERSONA_DOMAINS[persona]?.includes(domain) ? 20 : 0;
  return Math.round(base + relevance - Math.min(30, ageDays * 2));
}
function rankActivity(logs, persona, now = new Date()) {
  return logs.map(log => ({ ...log, importance: priority(log, persona, now) }))
    .sort((a, b) => b.importance - a.importance || new Date(b.createdAt) - new Date(a.createdAt));
}
module.exports = { priority, rankActivity };
