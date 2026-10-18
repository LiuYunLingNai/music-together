import React from 'react';
import * as THREE from 'three';
import { UNSUNG_UNIT_OPACITY } from './dioramaSceneConstants';
import { type PlacedUnitRaster } from './dioramaSceneTypes';
import { type DioramaUnitPlanes } from './dioramaSceneFrame';

// src/components/visualizer/diorama/DioramaActiveUnitPlanes.tsx
// 当前行逐单元的三层平面：普通辉光（叠加的心象辉光栅格）、灵魂出窍（叠加的清晰副本）、字身。
// 只负责挂载与登记材质 / 网格引用，每帧的颜色、透明度与位移由 dioramaSceneFrame 写入。
// 每个单元的三层平面放在同一个 group 里，智能动感模式下正在唱的字随拍跳起时整体移动（DioramaScene）；
// 平时 group 不动，画面和不分组时一样。

interface DioramaActiveUnitPlanesProps {
    units: readonly PlacedUnitRaster[];
    /** Filled by the ref callbacks; read by updateDioramaActiveUnits every frame. */
    planes: React.RefObject<DioramaUnitPlanes>;
    primaryColor: string;
    accentColor: string;
}

// 上游在 ref 回调里直接写 `planes.xxx[i] = el`；本项目 `react-hooks/immutability` 禁止在 JSX 里改值，
// 故接收 ref 对象、在函数体内登记（行为与上游一致）。
function registerPlane<K extends keyof DioramaUnitPlanes>(planes: React.RefObject<DioramaUnitPlanes>, key: K, index: number, value: DioramaUnitPlanes[K][number]) {
    const entries = planes.current[key] as Array<DioramaUnitPlanes[K][number]>;
    entries[index] = value;
}

export const DioramaActiveUnitPlanes: React.FC<DioramaActiveUnitPlanesProps> = ({ units, planes, primaryColor, accentColor }) => (
    <>
        {units.map((placed, unitIndex) => (
            <group key={unitIndex} ref={el => registerPlane(planes, 'unitGroups', unitIndex, el)}>
                <mesh
                    ref={el => registerPlane(planes, 'glowMeshes', unitIndex, el)}
                    visible={false}
                    position={[placed.centerX, 0, -0.01]}
                    renderOrder={17}
                >
                    <planeGeometry args={[placed.width, placed.height]} />
                    <meshBasicMaterial
                        ref={el => registerPlane(planes, 'glowMats', unitIndex, el)}
                        map={placed.raster.glowTexture}
                        transparent
                        opacity={0}
                        depthTest={false}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        color={accentColor}
                    />
                </mesh>
                {/* 灵魂出窍 ghost: the CRISP base raster (not the blurred glow) drawn
                    additively; useFrame lifts/swells/fades it as its envelope releases. */}
                <mesh
                    ref={el => registerPlane(planes, 'soulMeshes', unitIndex, el)}
                    visible={false}
                    position={[placed.centerX, 0, -0.005]}
                    renderOrder={18}
                >
                    <planeGeometry args={[placed.width, placed.height]} />
                    <meshBasicMaterial
                        ref={el => registerPlane(planes, 'soulMats', unitIndex, el)}
                        map={placed.raster.baseTexture}
                        transparent
                        opacity={0}
                        depthTest={false}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        color={primaryColor}
                    />
                </mesh>
                <mesh position={[placed.centerX, 0, 0]} renderOrder={19}>
                    <planeGeometry args={[placed.width, placed.height]} />
                    <meshBasicMaterial
                        ref={el => registerPlane(planes, 'baseMats', unitIndex, el)}
                        map={placed.raster.baseTexture}
                        transparent
                        opacity={UNSUNG_UNIT_OPACITY}
                        depthTest={false}
                        depthWrite={false}
                        color={primaryColor}
                    />
                </mesh>
            </group>
        ))}
    </>
);
