
module.exports =  function validateEvent(body) {
  if (!body) return false;

  const { type, session_id } = body;

  if (!type || !session_id) return false;

  if (!["page_view", "conversion"].includes(type)) return false;

  return true;
}