import { Router, type Router as RouterType } from 'express'
import { globalBackgroundRepo } from '../repositories/globalBackgroundRepository.js'

const router: RouterType = Router()

/** Public visual settings are safe to load before a user joins a room. */
router.get('/background', (_req, res) => {
  res.json(globalBackgroundRepo.get())
})

export default router
