import { defineTool } from 'adonis-ai'
import { z } from 'zod'

export default defineTool({
  name: 'local_weather',
  description: 'Get deterministic local demo weather for a city without making a network request.',
  input: z.object({
    city: z.string().min(1),
  }),
  execute({ city }) {
    const temperatureC = 16 + (city.length % 13)
    return {
      city,
      temperatureC,
      condition: city.length % 2 === 0 ? 'sunny' : 'partly cloudy',
      source: 'deterministic playground tool',
    }
  },
})
