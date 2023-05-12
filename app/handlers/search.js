import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { ROLE_AI, ROLE_HUMAN } from '../../services/openai.js';
import { fetchAnswer, generateCompletion } from '../../utils/index.js';
import { COMMAND_BOT_CONTINUE, COMMAND_BOT_SEARCH } from '../commands/index.js';
import Context from '../context.js';
import { updateHistory } from '../history/index.js';
import { getPrompt, setPrompt } from '../prompt/index.js';

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_SEARCH);

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    var trimmedText="";
    if(context.trimmedText.startsWith(COMMAND_BOT_SEARCH.aliases[0])){
      trimmedText=context.trimmedText.replace(COMMAND_BOT_SEARCH.aliases[0],"")
    }else if(context.trimmedText.startsWith(COMMAND_BOT_SEARCH.aliases[1])){
      trimmedText=context.trimmedText.replace(COMMAND_BOT_SEARCH.aliases[1],"");
    }else if(context.trimmedText.startsWith(COMMAND_BOT_SEARCH.text)){
      trimmedText=context.trimmedText.replace(COMMAND_BOT_SEARCH.text,"");
    }
    trimmedText=trimmedText.trim();
    const prompt = getPrompt("do-not-need-context");
    var answer;
    try {
      const q=trimmedText;
      answer = await fetchAnswer(trimmedText).answer;
      trimmedText = ``;
      console.log("answer:\n",answer);
      answer.forEach((e,i) => {
        trimmedText=trimmedText+`${i}、${e.snippet}\n`;
      });
      trimmedText=trimmedText+`\n\n以上每段文字的开头数字是该文字的编号。请根据与"${q}"关联度的高低顺序对以上${answer.length}段文字做降序排列，然后告诉我排序后的文字编号（无需文字本身，只要编号）。请不要有任何前置或者后置说明。"`;
    } catch (err) {
      return context.pushError(err);
    }
    prompt.write(ROLE_HUMAN, `${trimmedText}`).write(ROLE_AI);
    try {
      var { text } = await generateCompletion({ prompt });
      text="\n\n相关链接：\n";
      answer.forEach(function(e,i){
        text=text+i+"  "+e.link+"\n";
      })
      prompt.patch(text);
      context.pushText(text, []);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
