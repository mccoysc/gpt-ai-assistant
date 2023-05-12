import config from '../config/index.js';
import { search } from '../services/serpapi.js';

class OrganicResult {
  answer;

  constructor({
    answer,
  } = {}) {
    this.answer = answer;
  }
}

const fetchAnswer = async (q) => {
  if (config.APP_ENV !== 'production' || !config.SERPAPI_API_KEY) return new OrganicResult();
  const res = await search({ q });
  return { answer:res.data.organic_results}
};

export default fetchAnswer;
