/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

router.on('/').render('pages/home').as('home')
router.post('/api/ai/run', [controllers.AiPlayground, 'run'])
router.post('/api/ai/stream', [controllers.AiPlayground, 'stream'])
