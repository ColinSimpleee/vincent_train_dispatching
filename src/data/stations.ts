import type { RailMap } from '../core/RailGraph';

export interface StationConfig {
    id: string;
    name: string;
    description: string;
    difficulty: number; // 1-5 stars
    type: 'small' | 'hub' | 'terminal';
    mapData: RailMap;
}

// 1. 小站 (Teaching Station) - Double Line Through, 2 Island Platforms
export const stationSmall: StationConfig = {
    id: 'tutorial_small',
    name: '新手教学站',
    description: '典型的双线中间站。适合练习基本的进路控制与信号闭塞。',
    difficulty: 1,
    type: 'small',
    mapData: {
        nodes: {
            // Left Throat
            "n_L_in": { "id": "n_L_in", "x": 100, "y": 300, "type": "endpoint" },
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
            "n_sw_R": { "id": "n_sw_R", "x": 1700, "y": 300, "type": "switch", "signalState": "green" },
            "n_R_out": { "id": "n_R_out", "x": 4500, "y": 300, "type": "endpoint" }
        },
        edges: {
            "e_entry_L": { "id": "e_entry_L", "fromNode": "n_L_in", "toNode": "n_sw_L", "length": 200, "occupiedBy": null },
            
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
            
            // Throat Right (Simplified Outbound)
            "t1_out": { "id": "t1_out", "fromNode": "n_p1_end", "toNode": "n_sw_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:200}, "control2": {x:1600,y:300} },
            "t2_out": { "id": "t2_out", "fromNode": "n_p2_end", "toNode": "n_sw_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:260}, "control2": {x:1600,y:300} },
            "t3_out": { "id": "t3_out", "fromNode": "n_p3_end", "toNode": "n_sw_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:340}, "control2": {x:1600,y:300} },
            "t4_out": { "id": "t4_out", "fromNode": "n_p4_end", "toNode": "n_sw_R", "length": 300, "occupiedBy": null, "control1": {x:1600,y:400}, "control2": {x:1600,y:300} },
            
            "e_exit": { "id": "e_exit", "fromNode": "n_sw_R", "toNode": "n_R_out", "length": 3000, "occupiedBy": null },
        },
        platforms: [
            { id: "p1", label: "1 (Main)", rect: { x: 500, y: 210, w: 1000, h: 40 } }, // Platform Island 1 (Between T1/T2)
            { id: "p2", label: "2 (Main)", rect: { x: 500, y: 350, w: 1000, h: 40 } }  // Platform Island 2 (Between T3/T4)
        ]
    }
};

export const stationHub: StationConfig = {
    id: 'station_hub',
    name: '中心枢纽站 (Beta)',
    description: '复杂的8股道枢纽（目前暂用基础地图）。拥有极高的车流量。需精确控制信号以防级联晚点。',
    difficulty: 4,
    type: 'hub',
    mapData: { ...stationSmall.mapData } 
};

export const stationTerminal: StationConfig = {
    id: 'station_terminal',
    name: '海滨尽头站 (Beta)',
    description: '所有列车在此折返。需利用“换向”指令将列车调度至出站线路。',
    difficulty: 3,
    type: 'terminal',
    mapData: {
        nodes: {
            // Entry/Exit
            "n_in": { "id": "n_in", "x": 50, "y": 330, "type": "endpoint" },
            "n_out": { "id": "n_out", "x": 50, "y": 370, "type": "endpoint" },
            
            // Ladder Switches (Straight Diagonal)
            "n_sw_1": { "id": "n_sw_1", "x": 250, "y": 330, "type": "switch", "switchState": 0, "signalState": "green" }, // 0=T1, 1=Next
            "n_sw_2": { "id": "n_sw_2", "x": 350, "y": 360, "type": "switch", "switchState": 0, "signalState": "green" }, // 0=T2, 1=Next
            "n_sw_3": { "id": "n_sw_3", "x": 450, "y": 390, "type": "switch", "switchState": 0, "signalState": "green" }, // 0=T3, 1=T4

            // Platforms (x=600 start)
            "n_p1_start": { "id": "n_p1_start", "x": 600, "y": 200, "type": "connector", "signalState": "green" },
            "n_p1_end":   { "id": "n_p1_end",   "x": 2100, "y": 200, "type": "buffer_stop" },
            
            "n_p2_start": { "id": "n_p2_start", "x": 600, "y": 280, "type": "connector", "signalState": "green" },
            "n_p2_end":   { "id": "n_p2_end",   "x": 2100, "y": 280, "type": "buffer_stop" },
            
            "n_p3_start": { "id": "n_p3_start", "x": 600, "y": 380, "type": "connector", "signalState": "green" },
            "n_p3_end":   { "id": "n_p3_end",   "x": 2100, "y": 380, "type": "buffer_stop" },
            
            "n_p4_start": { "id": "n_p4_start", "x": 600, "y": 460, "type": "connector", "signalState": "green" },
            "n_p4_end":   { "id": "n_p4_end",   "x": 2100, "y": 460, "type": "buffer_stop" },
        },
        edges: {
            // -- INBOUND (Straight Lines) --
            "e_in": { "id": "e_in", "fromNode": "n_in", "toNode": "n_sw_1", "length": 200, "occupiedBy": null },
            
            // Ladder Logic (Top to Bottom)
            // S1 -> T1 (Up-Left)
            "e_s1_t1": { "id": "e_s1_t1", "fromNode": "n_sw_1", "toNode": "n_p1_start", "length": 400, "occupiedBy": null, "control1":{x:300,y:330}, "control2":{x:300,y:200} },
            // S1 -> S2 (Diagonal Down)
            "e_s1_s2": { "id": "e_s1_s2", "fromNode": "n_sw_1", "toNode": "n_sw_2", "length": 150, "occupiedBy": null },
            
            // S2 -> T2 (Up-Left)
            "e_s2_t2": { "id": "e_s2_t2", "fromNode": "n_sw_2", "toNode": "n_p2_start", "length": 300, "occupiedBy": null, "control1":{x:400,y:360}, "control2":{x:400,y:280} },
            // S2 -> S3 (Diagonal Down)
            "e_s2_s3": { "id": "e_s2_s3", "fromNode": "n_sw_2", "toNode": "n_sw_3", "length": 150, "occupiedBy": null },

            // S3 -> T3 (Up-Left) / T4 (Down-Right)
            "e_s3_t3": { "id": "e_s3_t3", "fromNode": "n_sw_3", "toNode": "n_p3_start", "length": 200, "occupiedBy": null, "control1":{x:500,y:390}, "control2":{x:500,y:380} },
            "e_s3_t4": { "id": "e_s3_t4", "fromNode": "n_sw_3", "toNode": "n_p4_start", "length": 200, "occupiedBy": null, "control1":{x:500,y:390}, "control2":{x:500,y:460} },

            // Tracks
            "t1": { "id": "t1", "fromNode": "n_p1_start", "toNode": "n_p1_end", "length": 1500, "occupiedBy": null, "isPlatform": true },
            "t2": { "id": "t2", "fromNode": "n_p2_start", "toNode": "n_p2_end", "length": 1500, "occupiedBy": null, "isPlatform": true },
            "t3": { "id": "t3", "fromNode": "n_p3_start", "toNode": "n_p3_end", "length": 1500, "occupiedBy": null, "isPlatform": true },
            "t4": { "id": "t4", "fromNode": "n_p4_start", "toNode": "n_p4_end", "length": 1500, "occupiedBy": null, "isPlatform": true },

            // -- OUTBOUND --
            "t1_rev": { "id": "t1_rev", "fromNode": "n_p1_end", "toNode": "n_p1_start", "length": 1500, "occupiedBy": null },
            "t2_rev": { "id": "t2_rev", "fromNode": "n_p2_end", "toNode": "n_p2_start", "length": 1500, "occupiedBy": null },
            "t3_rev": { "id": "t3_rev", "fromNode": "n_p3_end", "toNode": "n_p3_start", "length": 1500, "occupiedBy": null },
            "t4_rev": { "id": "t4_rev", "fromNode": "n_p4_end", "toNode": "n_p4_start", "length": 1500, "occupiedBy": null },
            
            "t1_out": { "id": "t1_out", "fromNode": "n_p1_start", "toNode": "n_sw_1", "length": 400, "occupiedBy": null },
            "t2_out": { "id": "t2_out", "fromNode": "n_p2_start", "toNode": "n_sw_2", "length": 300, "occupiedBy": null },
            "t3_out": { "id": "t3_out", "fromNode": "n_p3_start", "toNode": "n_sw_3", "length": 200, "occupiedBy": null },
            "t4_out": { "id": "t4_out", "fromNode": "n_p4_start", "toNode": "n_sw_3", "length": 200, "occupiedBy": null },
            
            "e_s3_s2_rev": { "id": "e_s3_s2_rev", "fromNode": "n_sw_3", "toNode": "n_sw_2", "length": 150, "occupiedBy": null },
            "e_s2_s1_rev": { "id": "e_s2_s1_rev", "fromNode": "n_sw_2", "toNode": "n_sw_1", "length": 150, "occupiedBy": null },
            "e_out": { "id": "e_out", "fromNode": "n_sw_1", "toNode": "n_out", "length": 200, "occupiedBy": null }
        },
        platforms: [
            { id: "p1", label: "1 (Term)", rect: { x: 600, y: 220, w: 1500, h: 40 } },
            { id: "p2", label: "2 (Term)", rect: { x: 600, y: 400, w: 1500, h: 40 } }
        ]
    }
};

export const allStations = [stationSmall, stationHub, stationTerminal];
