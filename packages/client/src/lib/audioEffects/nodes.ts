export interface AudioEffectNodes {
  highpass: BiquadFilterNode
  lowpass: BiquadFilterNode
  /** 两个截止滤波器都在中性端点时走的直通支路。 */
  filterBypass: GainNode
  /** 滤波器支路的回混增益，与 filterBypass 互补淡化。 */
  filterReturn: GainNode
  drive: WaveShaperNode
  crush: WaveShaperNode
  wowDelay: DelayNode
  stereoInput: GainNode
  splitter: ChannelSplitterNode
  merger: ChannelMergerNode
  leftDirect: GainNode
  rightDirect: GainNode
  leftCross: GainNode
  rightCross: GainNode
  compressor: DynamicsCompressorNode
  makeup: GainNode
  dry: GainNode
  wetSend: GainNode
  wet: GainNode
  noiseGain: GainNode
}

export const WOW_BASE_DELAY_SECONDS = 0.012

export const createAudioEffectNodes = (context: AudioContext): AudioEffectNodes => {
  const highpass = context.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.Q.value = 0.7
  highpass.frequency.value = 20

  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.Q.value = 0.7
  lowpass.frequency.value = Math.min(20000, context.sampleRate * 0.475)

  const drive = context.createWaveShaper()
  // 软削波的谐波会越过 Nyquist，混叠会让音色发刺。
  drive.oversample = '4x'

  const crush = context.createWaveShaper()

  const wowDelay = context.createDelay(0.2)
  wowDelay.delayTime.value = 0

  // 单声道源也要能喂满 mid/side 两条腿。
  const stereoInput = context.createGain()
  stereoInput.channelCount = 2
  stereoInput.channelCountMode = 'explicit'
  stereoInput.channelInterpretation = 'speakers'

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = 0
  compressor.knee.value = 30
  compressor.ratio.value = 1
  compressor.attack.value = 0.008
  compressor.release.value = 0.18

  const createGain = (value: number): GainNode => {
    const node = context.createGain()
    node.gain.value = value
    return node
  }

  return {
    highpass,
    lowpass,
    filterBypass: createGain(1),
    filterReturn: createGain(0),
    drive,
    crush,
    wowDelay,
    stereoInput,
    splitter: context.createChannelSplitter(2),
    merger: context.createChannelMerger(2),
    leftDirect: createGain(1),
    rightDirect: createGain(1),
    leftCross: createGain(0),
    rightCross: createGain(0),
    compressor,
    makeup: createGain(1),
    dry: createGain(1),
    wetSend: createGain(1),
    wet: createGain(0),
    noiseGain: createGain(0),
  }
}

export const connectAudioEffectNodes = (nodes: AudioEffectNodes, input: AudioNode, output: AudioNode): void => {
  // 截止滤波器单独走一条支路，而不是串在主路上。即使停在中性端点（20 Hz / 20 kHz），
  // biquad 也不透明：20 Hz 高通会把低频相位转几十度，峰值落点随之偏移。接近满幅的
  // 母带因此可能被推出 0 dBFS（实测 +1.3 dB），全部音效关闭时照样在输出端削波。
  input.connect(nodes.filterBypass)
  input.connect(nodes.highpass)
  nodes.highpass.connect(nodes.lowpass)
  nodes.lowpass.connect(nodes.filterReturn)
  nodes.filterBypass.connect(nodes.drive)
  nodes.filterReturn.connect(nodes.drive)
  nodes.drive.connect(nodes.crush)
  nodes.crush.connect(nodes.wowDelay)
  nodes.wowDelay.connect(nodes.stereoInput)
  nodes.stereoInput.connect(nodes.splitter)

  nodes.splitter.connect(nodes.leftDirect, 0, 0)
  nodes.splitter.connect(nodes.rightCross, 1, 0)
  nodes.splitter.connect(nodes.leftCross, 0, 0)
  nodes.splitter.connect(nodes.rightDirect, 1, 0)
  nodes.leftDirect.connect(nodes.merger, 0, 0)
  nodes.rightCross.connect(nodes.merger, 0, 0)
  nodes.leftCross.connect(nodes.merger, 0, 1)
  nodes.rightDirect.connect(nodes.merger, 0, 1)

  nodes.merger.connect(nodes.compressor)
  nodes.compressor.connect(nodes.makeup)
  nodes.makeup.connect(nodes.dry)
  nodes.makeup.connect(nodes.wetSend)
  nodes.dry.connect(output)
  nodes.wet.connect(output)
  nodes.noiseGain.connect(output)
}

export const disconnectAudioEffectNodes = (nodes: AudioEffectNodes, input: AudioNode): void => {
  for (const entry of [nodes.highpass, nodes.filterBypass]) {
    try {
      input.disconnect(entry)
    } catch {
      // 音频图可能已随 AudioContext 一起销毁。
    }
  }
  Object.values(nodes).forEach((node) => node.disconnect())
}
