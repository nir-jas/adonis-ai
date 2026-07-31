import { BaseAgent } from 'adonis-ai'
import LocalWeatherTool from '../tools/local_weather_tool.js'

export default class PlaygroundAgent extends BaseAgent {
  instructions() {
    return [
      'You are the Adonis AI SDK playground assistant.',
      'Be concise and practical.',
      'Use the local_weather tool whenever the user asks about weather.',
    ].join(' ')
  }

  tools() {
    return [LocalWeatherTool]
  }
}
