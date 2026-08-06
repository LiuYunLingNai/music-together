import { motion } from 'motion/react'

export function HeroSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mt-hero mb-8 px-6 text-center"
    >
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        <span className="flex items-end gap-0.5" aria-hidden="true">
          <i className="h-1 w-0.5 rounded-full bg-current" />
          <i className="h-2.5 w-0.5 rounded-full bg-current" />
          <i className="h-1.5 w-0.5 rounded-full bg-current" />
        </span>
        实时同步音乐播放
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">和朋友一起听歌</h1>
      <p className="mt-2 text-sm text-muted-foreground">创建或加入一个房间，实时同步音乐播放</p>
    </motion.div>
  )
}
