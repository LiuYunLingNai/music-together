import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, NumberField, Row, Segmented, Select, Status, TextArea } from '../../modal/settings/kit';
import { SliderRow, percent, ToggleRow } from '../panelRows';
import type { VisualizerSettingsPanelProps } from '../definition';
import { usePlaybackStore, getPlaybackSongKey } from '../../../adapters/kineticPlayback';
import { readKineticProject, writeKineticProject } from './kineticProjectMemory';
import { resolveKineticProjectLyrics } from './kineticEditorIdentity';
import { saveExportFile } from './saveExportFile';
import {
    KINETIC_STYLES, KINETIC_LAYOUTS, KINETIC_EFFECTS, normalizeKineticTuning, kineticLrc,
    makeKineticSongProject, importKineticSongProject, type KineticTuning,
    kineticEditedLyricsMatchTiming,
} from './kineticSettings';

// Primary: edit the look while watching the existing preview. Secondary: keep a look for this song.
// Uses the surrounding window's kit cards, rows, typography, colors and slider draft/commit gate.
const KineticSettingsPanel = ({ tuning, onTuningChange, onSliderPointerDown, onSliderCommit }: VisualizerSettingsPanelProps<KineticTuning>) => {
    const value = normalizeKineticTuning(tuning);
    const change = (patch: Partial<KineticTuning>) => onTuningChange?.(patch);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const songKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const source = useMemo(() => kineticLrc(lyrics?.lines ?? []), [lyrics]);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setRevision(before => before + 1);
        window.addEventListener('kinetic:project-saved', refresh);
        return () => window.removeEventListener('kinetic:project-saved', refresh);
    }, []);
    const saved = useMemo(() => readKineticProject(songKey), [songKey, revision]);
    const ready = Boolean(songKey && source);
    const fileRef = useRef<HTMLInputElement>(null);
    const identity = useRef({ songKey, source });
    identity.current = { songKey, source };
    const [message, setMessage] = useState<{ key: string | null; text: string } | null>(null);
    const setStatus = (text: string) => setMessage({ key: songKey, text });
    const status = message?.key === songKey ? message.text : '';
    const [textDraft, setTextDraft] = useState<{ key: string; source: string; text: string } | null>(null);
    const text = textDraft?.key === songKey && textDraft.source === source ? textDraft.text : resolveKineticProjectLyrics(saved, source);
    const keep = () => {
        if (!ready) return;
        if (!kineticEditedLyricsMatchTiming(text, source)) {
            setStatus('请保留每行原有的 LRC 时间标签；时间校准在播放器歌词设置中调整。');
            return;
        }
        writeKineticProject(songKey, { ...makeKineticSongProject(value, source, saved), lyrics: text });
        setStatus('歌词已保存到这首歌。');
    };
    const restore = () => {
        writeKineticProject(songKey, null);
        setTextDraft(null);
        setStatus('这首歌已恢复全局配置，其他歌曲不受影响。');
    };
    const importFile = async (file: File | undefined) => {
        if (!file || !ready) return;
        const started = { songKey, source };
        try {
            if (file.size > 524288) throw new Error('工程文件不能超过 512 KB');
            const imported = importKineticSongProject(await file.text(), source);
            if (identity.current.songKey !== started.songKey || identity.current.source !== started.source) return;
            writeKineticProject(songKey, imported);
            setTextDraft(null);
            setStatus('已导入这首歌的风格、特效与歌词。');
        } catch (error) {
            if (identity.current.songKey === started.songKey) setStatus(error instanceof Error ? error.message : '导入失败');
        }
    };

    return (
        <>
            <Group def={{ id: 'vis-kinetic-scope', titleKey: 'options.kineticScopeSection' }} foot="设置只保存在当前浏览器；切换模式会保留全局和逐曲配置。字体与字幕继续共用窗口设置。">
                <Row label="配置模式" hint={value.scope === 'global' ? '所有歌曲使用同一套配置' : '只修改当前歌曲；没有独立配置时沿用全局设置'}>
                    <Segmented value={value.scope} options={[{ value: 'global', label: '全局模式' }, { value: 'song', label: '逐曲模式' }]} onChange={scope => {
                        onSliderCommit?.();
                        onTuningChange?.({ scope });
                    }} />
                </Row>
                {value.scope === 'song' && <Row label={currentSong?.name ?? '当前没有歌曲'} hint={!ready ? '加载歌曲歌词后可编辑' : saved ? '已有独立配置，调整后自动保存' : '沿用全局配置，首次调整后保存为独立配置'} />}
            </Group>
            <fieldset disabled={value.scope === 'song' && !ready} className="min-w-0 border-0 p-0 disabled:opacity-40">
            <Group def={{ id: 'vis-kinetic-look', titleKey: 'options.kineticLookSection' }} foot="实时预览显示当前歌曲；内置演示使用下面的参数，不加载歌曲改词。">
                <Row label="风格"><Select value={value.style} options={KINETIC_STYLES} onChange={style => change({ style })} /></Row>
                <Row label="配色"><Segmented value={value.colorSource} options={[{ value: 'theme', label: '项目主题' }, { value: 'style', label: '风格原色' }]} onChange={colorSource => change({ colorSource })} /></Row>
                <Row label="文字布局"><Select value={value.layout} options={KINETIC_LAYOUTS} onChange={layout => change({ layout })} /></Row>
                <Row label="编排种子">
                    <NumberField value={value.seed} min={0} max={2147483647} step={1} onChange={seed => seed !== null && change({ seed })} />
                    <Button variant="quiet" onClick={() => change({ seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff })}>重新编排</Button>
                </Row>
                <ToggleRow label="统一构图" checked={value.unify} onChange={unify => change({ unify })} />
                <ToggleRow label="文字整列" checked={value.typeset} onChange={typeset => change({ typeset })} />
            </Group>
            <Group def={{ id: 'vis-kinetic-effects', titleKey: 'options.kineticEffectsSection' }}>
                {KINETIC_EFFECTS.map(([key, label]) => <SliderRow key={key} label={label} value={value[key]} min={0} max={1} step={0.01} format={percent}
                    onChange={number => change({ [key]: number })} onDragStart={onSliderPointerDown} onDragEnd={onSliderCommit} />)}
                <ToggleRow label="闪光" checked={value.flash} onChange={flash => change({ flash })} />
                <Row label="画面标记"><Select value={value.hud} options={[{ value: 'auto', label: '自动' }, { value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }]} onChange={hud => change({ hud })} /></Row>
                <ToggleRow label="隐藏编号" checked={value.hideNo} onChange={hideNo => change({ hideNo })} />
                <ToggleRow label="隐藏时间" checked={value.hideTime} onChange={hideTime => change({ hideTime })} />
            </Group>
            <Group def={{ id: 'vis-kinetic-parts', titleKey: 'options.kineticPartsSection' }}>
                {([['extra', '扩展效果'], ['wa', '和风图案'], ['horror', '悬疑效果'], ['typo', '文字 PV 排版'], ['kinetic', '逐词动态排版']] as const).map(([key, label]) => (
                    <ToggleRow key={key} label={label} checked={value[key]} onChange={checked => change({ [key]: checked })} />
                ))}
            </Group>
            </fieldset>
            {value.scope === 'song' && <Group def={{ id: 'vis-kinetic-song', titleKey: 'options.kineticSongSection' }} foot="配置自动保存到当前歌曲；滑块松手时保存。歌词文字编辑后单独保存，并保留 LRC 时间标签。">
                <Row label={currentSong?.name ?? '当前没有歌曲'} hint={ready ? '保存当前配置或修改这首歌的文字' : '加载当前歌曲歌词后可保存'} />
                <Row label="歌词文本" disabled={!ready} below={<TextArea value={text} disabled={!ready} onChange={next => {
                    if (songKey && next.length <= 80000) setTextDraft({ key: songKey, source, text: next });
                }} />} />
                <Row label="逐曲工程">
                    <Button variant="primary" disabled={!ready} onClick={keep}>保存歌词</Button>
                    <Button variant="quiet" disabled={!saved} onClick={restore}>恢复全局配置</Button>
                </Row>
                <Row label="工程文件">
                    <Button variant="quiet" disabled={!ready} onClick={() => fileRef.current?.click()}>导入</Button>
                    <Button variant="quiet" disabled={!ready} onClick={() => {
                        const exported = saved ?? { ...makeKineticSongProject(value, source, saved), lyrics: text };
                        void saveExportFile(`${currentSong?.name ?? '文字PV'}.jizura.json`, JSON.stringify(exported, null, 2), 'application/json');
                    }}>导出</Button>
                </Row>
                <input ref={fileRef} hidden type="file" accept=".json,.jizura.json,application/json" onChange={event => {
                    void importFile(event.target.files?.[0]);
                    event.target.value = '';
                }} />
                {status && <Row below={<Status>{status}</Status>} />}
            </Group>}
        </>
    );
};
export default KineticSettingsPanel;
