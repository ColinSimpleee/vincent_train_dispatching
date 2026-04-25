import type { RailMap } from '../core/RailGraph';
import type { ScheduleConfig } from '../core/types';

export interface StationConfig {
    id: string;
    name: string;
    nameEn: string;
    description: string;
    difficulty: number;
    type: 'small' | 'hub' | 'terminal';
    enabled: boolean;
    mapData: RailMap;
    scheduleConfig: ScheduleConfig;
}

// 1. 小站 (Teaching Station) - Double Line Through, 2 Island Platforms
export const stationSmall: StationConfig = {
    id: 'tutorial',
    name: '新手教学站',
    nameEn: 'Tutorial Terminal',
    description: '基础的四站台车站。适合练习基本的进路控制与信号闭塞。',
    difficulty: 1,
    type: 'small',
    enabled: true,
    scheduleConfig: {
        peakIntervalRange: [4, 6],
        offPeakIntervalRange: [8, 12],
        peakWindows: [[420, 540], [1020, 1140]],
        directionRatio: 1.0, // 单线车站，只有上行
    },
    mapData: {
        nodes: {
            // Left Throat — 入口 endpoint 推到画布外 (-200)，让进站轨道延伸到 x=0 边缘
            // 而不是停在 x=100 留个空缺；不取太大值是为了避免列车在 1× 速度下花太久才到道岔
            "n_L_in": { "id": "n_L_in", "x": -200, "y": 300, "type": "endpoint" },
            "n_sw_L": { "id": "n_sw_L", "x": 300, "y": 300, "type": "switch", "signalState": "green" }, // Main Switch Left
            
            // Platforms (Double Island: 4 tracks)
            // Track 1 (Up Main)
            "n_p1_start": { "id": "n_p1_start", "x": 500, "y": 200, "type": "connector", "signalState": "green" },
            "n_p1_end":   { "id": "n_p1_end",   "x": 1500, "y": 200, "type": "connector", "signalState": "green" },
            // Track 2 (Up Siding)
            "n_p2_start": { "id": "n_p2_start", "x": 500, "y": 260, "type": "connector", "signalState": "green" },
            "n_p2_end":   { "id": "n_p2_end",   "x": 1500, "y": 260, "type": "connector", "signalState": "green" },
            
            // Track 3 (Down Siding)
            "n_p3_start": { "id": "n_p3_start", "x": 500, "y": 340, "type": "connector", "signalState": "green" },
            "n_p3_end":   { "id": "n_p3_end",   "x": 1500, "y": 340, "type": "connector", "signalState": "green" },
            // Track 4 (Down Main)
            "n_p4_start": { "id": "n_p4_start", "x": 500, "y": 400, "type": "connector", "signalState": "green" },
            "n_p4_end":   { "id": "n_p4_end",   "x": 1500, "y": 400, "type": "connector", "signalState": "green" },

            // Right Throat
            "n_sw_R": { "id": "n_sw_R", "x": 1700, "y": 300, "type": "switch", "switchState": 0, "signalState": "green" },
            "n_merge_R": { "id": "n_merge_R", "x": 1700, "y": 300, "type": "connector" },
            "n_R_in": { "id": "n_R_in", "x": 10000, "y": 300, "type": "endpoint" },
            "n_R_out": { "id": "n_R_out", "x": 10000, "y": 300, "type": "endpoint" }
        },
        edges: {
            // 长度 500：n_L_in (-200) → n_sw_L (300)，列车出生点正好在屏外，
            // 进入可视区域后约 5 秒(1×)能到达道岔
            "e_entry_L": { "id": "e_entry_L", "fromNode": "n_L_in", "toNode": "n_sw_L", "length": 500, "occupiedBy": null },
            
            // Throat Left
            "e_L_t1": { "id": "e_L_t1", "fromNode": "n_sw_L", "toNode": "n_p1_start", "length": 300, "occupiedBy": null, "control1": {x:400,y:300}, "control2": {x:400,y:200} },
            "e_L_t2": { "id": "e_L_t2", "fromNode": "n_sw_L", "toNode": "n_p2_start", "length": 300, "occupiedBy": null, "control1": {x:400,y:300}, "control2": {x:400,y:260} },
            "e_L_t3": { "id": "e_L_t3", "fromNode": "n_sw_L", "toNode": "n_p3_start", "length": 300, "occupiedBy": null, "control1": {x:400,y:300}, "control2": {x:400,y:340} },
            "e_L_t4": { "id": "e_L_t4", "fromNode": "n_sw_L", "toNode": "n_p4_start", "length": 300, "occupiedBy": null, "control1": {x:400,y:300}, "control2": {x:400,y:400} },
            
            // Tracks
            "t1": { "id": "t1", "fromNode": "n_p1_start", "toNode": "n_p1_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            "t2": { "id": "t2", "fromNode": "n_p2_start", "toNode": "n_p2_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            "t3": { "id": "t3", "fromNode": "n_p3_start", "toNode": "n_p3_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            "t4": { "id": "t4", "fromNode": "n_p4_start", "toNode": "n_p4_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            
            // Throat Right - Outbound (Merging: 4 tracks → merge node → exit)
            "t1_out": { "id": "t1_out", "fromNode": "n_p1_end", "toNode": "n_merge_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:200}, "control2": {x:1600,y:300} },
            "t2_out": { "id": "t2_out", "fromNode": "n_p2_end", "toNode": "n_merge_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:260}, "control2": {x:1600,y:300} },
            "t3_out": { "id": "t3_out", "fromNode": "n_p3_end", "toNode": "n_merge_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:340}, "control2": {x:1600,y:300} },
            "t4_out": { "id": "t4_out", "fromNode": "n_p4_end", "toNode": "n_merge_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:400}, "control2": {x:1600,y:300} },
            
            // Throat Right - Inbound (Diverging: entry → switch → 4 tracks, controlled by switchState)
            "e_entry_R": { "id": "e_entry_R", "fromNode": "n_R_in", "toNode": "n_sw_R", "length": 8300, "occupiedBy": null },
            "e_R_in_t1": { "id": "e_R_in_t1", "fromNode": "n_sw_R", "toNode": "n_p1_end", "length": 300, "occupiedBy": null, "control1": {x:1600,y:300}, "control2": {x:1600,y:200} },
            "e_R_in_t2": { "id": "e_R_in_t2", "fromNode": "n_sw_R", "toNode": "n_p2_end", "length": 300, "occupiedBy": null, "control1": {x:1600,y:300}, "control2": {x:1600,y:260} },
            "e_R_in_t3": { "id": "e_R_in_t3", "fromNode": "n_sw_R", "toNode": "n_p3_end", "length": 300, "occupiedBy": null, "control1": {x:1600,y:300}, "control2": {x:1600,y:340} },
            "e_R_in_t4": { "id": "e_R_in_t4", "fromNode": "n_sw_R", "toNode": "n_p4_end", "length": 300, "occupiedBy": null, "control1": {x:1600,y:300}, "control2": {x:1600,y:400} },
            
            "e_exit": { "id": "e_exit", "fromNode": "n_merge_R", "toNode": "n_R_out", "length": 8300, "occupiedBy": null },
        },
        platforms: [
            { id: "p1", label: "1 (Main)", rect: { x: 500, y: 210, w: 1000, h: 40 } }, // Platform Island 1 (Between T1/T2)
            { id: "p2", label: "2 (Main)", rect: { x: 500, y: 350, w: 1000, h: 40 } }  // Platform Island 2 (Between T3/T4)
        ]
    }
};

export const stationHub: StationConfig = {
    id: 'hub',
    name: '中心枢纽站',
    nameEn: 'Central Junction',
    description: '六股道 + 多组道岔交织，高密度班次与重联列车。',
    difficulty: 5,
    type: 'hub',
    enabled: false,
    scheduleConfig: {
        peakIntervalRange: [2, 3],
        offPeakIntervalRange: [4, 6],
        peakWindows: [[420, 540], [1020, 1140]],
        directionRatio: 0.5,
        lines: ['京沪', '沪昆', '沪宁城际'],
        lineTrafficWeight: { '京沪': 3, '沪昆': 2, '沪宁城际': 1 },
    },
    mapData: { ...stationSmall.mapData }
};

export const stationTerminal: StationConfig = {
    id: 'terminal',
    name: '终端车站',
    nameEn: 'Northbank Terminal',
    description: '剪式渡线 + 4 股道 + 车挡尽头，列车在此折返。',
    difficulty: 3,
    type: 'terminal',
    enabled: true,
    scheduleConfig: {
        peakIntervalRange: [4, 6],
        offPeakIntervalRange: [8, 12],
        peakWindows: [[420, 540], [1020, 1140]],
        directionRatio: 0.5,
    },
    mapData: {
        nodes: {
            // Entry endpoints (画布左外侧)，y 距离压缩到 120 让上下行更靠近
            "n_L_in_U": { "id": "n_L_in_U", "x": -200, "y": 240, "type": "endpoint" },
            "n_L_in_D": { "id": "n_L_in_D", "x": -200, "y": 360, "type": "endpoint" },

            // 剪式渡线 4 角点 (groupId 联动：4 个开关一次切换)
            "n_x1": { "id": "n_x1", "x": 300, "y": 240, "type": "switch", "switchState": 0, "signalState": "green", "groupId": "crossover" },
            "n_x2": { "id": "n_x2", "x": 300, "y": 360, "type": "switch", "switchState": 1, "signalState": "green", "groupId": "crossover" },
            "n_x3": { "id": "n_x3", "x": 700, "y": 240, "type": "switch", "switchState": 0, "signalState": "green", "groupId": "crossover" },
            "n_x4": { "id": "n_x4", "x": 700, "y": 360, "type": "switch", "switchState": 1, "signalState": "green", "groupId": "crossover" },

            // 1-to-2 分岔道岔 (与渡线收尾边同 y，保证收尾边是水平直线)
            "n_sw_U": { "id": "n_sw_U", "x": 900, "y": 240, "type": "switch", "switchState": 0, "signalState": "green" },
            "n_sw_D": { "id": "n_sw_D", "x": 900, "y": 360, "type": "switch", "switchState": 0, "signalState": "green" },

            // 站台两端
            "n_p1_start": { "id": "n_p1_start", "x": 1100, "y": 200, "type": "connector", "signalState": "green" },
            "n_p1_end":   { "id": "n_p1_end",   "x": 2100, "y": 200, "type": "buffer_stop" },
            "n_p2_start": { "id": "n_p2_start", "x": 1100, "y": 280, "type": "connector", "signalState": "green" },
            "n_p2_end":   { "id": "n_p2_end",   "x": 2100, "y": 280, "type": "buffer_stop" },
            "n_p3_start": { "id": "n_p3_start", "x": 1100, "y": 320, "type": "connector", "signalState": "green" },
            "n_p3_end":   { "id": "n_p3_end",   "x": 2100, "y": 320, "type": "buffer_stop" },
            "n_p4_start": { "id": "n_p4_start", "x": 1100, "y": 400, "type": "connector", "signalState": "green" },
            "n_p4_end":   { "id": "n_p4_end",   "x": 2100, "y": 400, "type": "buffer_stop" },
        },
        edges: {
            // 进站轨道 (左屏外伸进来)
            "e_entry_U": { "id": "e_entry_U", "fromNode": "n_L_in_U", "toNode": "n_x1", "length": 500, "occupiedBy": null },
            "e_entry_D": { "id": "e_entry_D", "fromNode": "n_L_in_D", "toNode": "n_x2", "length": 500, "occupiedBy": null },

            // 剪式渡线
            // 顶部直行: x1 -> x3 (y=240)
            "e_x1_x3_str": { "id": "e_x1_x3_str", "fromNode": "n_x1", "toNode": "n_x3", "length": 400, "occupiedBy": null },
            // 底部直行: x2 -> x4 (y=360)
            "e_x2_x4_str": { "id": "e_x2_x4_str", "fromNode": "n_x2", "toNode": "n_x4", "length": 400, "occupiedBy": null },
            // 左上→右下对角: x1 -> x4
            "e_x1_x4_div": { "id": "e_x1_x4_div", "fromNode": "n_x1", "toNode": "n_x4", "length": 420, "occupiedBy": null, "control1": { x: 500, y: 240 }, "control2": { x: 500, y: 360 } },
            // 左下→右上对角: x2 -> x3
            "e_x2_x3_div": { "id": "e_x2_x3_div", "fromNode": "n_x2", "toNode": "n_x3", "length": 420, "occupiedBy": null, "control1": { x: 500, y: 360 }, "control2": { x: 500, y: 240 } },

            // 渡线收尾 → 分岔道岔 (水平直线，y 全部 240/360)
            "e_x3_swU": { "id": "e_x3_swU", "fromNode": "n_x3", "toNode": "n_sw_U", "length": 200, "occupiedBy": null },
            "e_x4_swD": { "id": "e_x4_swD", "fromNode": "n_x4", "toNode": "n_sw_D", "length": 200, "occupiedBy": null },

            // 1-to-2 分岔 → 站台头
            "e_swU_T1": { "id": "e_swU_T1", "fromNode": "n_sw_U", "toNode": "n_p1_start", "length": 220, "occupiedBy": null, "control1": { x: 1000, y: 240 }, "control2": { x: 1000, y: 200 } },
            "e_swU_T2": { "id": "e_swU_T2", "fromNode": "n_sw_U", "toNode": "n_p2_start", "length": 220, "occupiedBy": null, "control1": { x: 1000, y: 240 }, "control2": { x: 1000, y: 280 } },
            "e_swD_T3": { "id": "e_swD_T3", "fromNode": "n_sw_D", "toNode": "n_p3_start", "length": 220, "occupiedBy": null, "control1": { x: 1000, y: 360 }, "control2": { x: 1000, y: 320 } },
            "e_swD_T4": { "id": "e_swD_T4", "fromNode": "n_sw_D", "toNode": "n_p4_start", "length": 220, "occupiedBy": null, "control1": { x: 1000, y: 360 }, "control2": { x: 1000, y: 400 } },

            // 站台轨道 (终点车挡)
            "t1": { "id": "t1", "fromNode": "n_p1_start", "toNode": "n_p1_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            "t2": { "id": "t2", "fromNode": "n_p2_start", "toNode": "n_p2_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            "t3": { "id": "t3", "fromNode": "n_p3_start", "toNode": "n_p3_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
            "t4": { "id": "t4", "fromNode": "n_p4_start", "toNode": "n_p4_end", "length": 1000, "occupiedBy": null, "isPlatform": true },
        },
        platforms: [
            { id: "p1", label: "1 (Term)", rect: { x: 1100, y: 220, w: 1000, h: 40 } },
            { id: "p2", label: "2 (Term)", rect: { x: 1100, y: 340, w: 1000, h: 40 } }
        ],
        switchGroups: [
            // 剪式渡线联动：mode 0 = 直连(各自原线)，mode 1 = 交叉(上下互换)
            // 每个成员的 states[mode] 是该成员节点在该模式下应有的 switchState
            {
                id: 'crossover',
                masterNodeId: 'n_x1',
                members: [
                    { nodeId: 'n_x1', states: [0, 1] },  // 出向: 0=x3_str(straight), 1=x4_div(cross)
                    { nodeId: 'n_x2', states: [1, 0] },  // 出向: 0=x3_div, 1=x4_str → 反过来
                    { nodeId: 'n_x3', states: [0, 1] },  // 入向: 0=x1_str(back to top), 1=x2_div
                    { nodeId: 'n_x4', states: [1, 0] },  // 入向: 0=x1_div, 1=x2_str → 反过来
                ]
            }
        ]
    }
};

// --- Locked placeholder stations (即将发布) ---
const emptyMap: RailMap = { nodes: {}, edges: {}, platforms: [] };
const placeholderSchedule: ScheduleConfig = {
    peakIntervalRange: [4, 6],
    offPeakIntervalRange: [8, 12],
    peakWindows: [[420, 540], [1020, 1140]],
    directionRatio: 0.5,
};

export const stationMountain: StationConfig = {
    id: 'mountain',
    name: '山岭会让站',
    nameEn: 'Ridgepass Loop',
    description: '曲线轨道 + 会让逻辑，听候发布。',
    difficulty: 2,
    type: 'small',
    enabled: false,
    mapData: emptyMap,
    scheduleConfig: placeholderSchedule,
};

export const stationPort: StationConfig = {
    id: 'port',
    name: '港城联络站',
    nameEn: 'Portside Link',
    description: '客货混行分流。开发中。',
    difficulty: 4,
    type: 'hub',
    enabled: false,
    mapData: emptyMap,
    scheduleConfig: placeholderSchedule,
};

export const stationExpress: StationConfig = {
    id: 'express',
    name: '高速越行线',
    nameEn: 'Express Bypass',
    description: '高速列车不停站越行。即将开放。',
    difficulty: 4,
    type: 'terminal',
    enabled: false,
    mapData: emptyMap,
    scheduleConfig: placeholderSchedule,
};

// 首页顺序：tutorial → terminal → hub → mountain → port → express
export const allStations: StationConfig[] = [
    stationSmall,
    stationTerminal,
    stationHub,
    stationMountain,
    stationPort,
    stationExpress,
];
