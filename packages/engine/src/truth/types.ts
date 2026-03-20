// 真相文件类型定义

/** 真相文件内容 */
export interface TruthFiles {
  currentState: string;
  pendingHooks: string;
  characterMatrix: string;
}

/** 写后结算数据 */
export interface SettlementData {
  characterInteractions: CharacterInteraction[];
  hookChanges: HookChange[];
  worldStateChanges: WorldStateChange[];
  upgradeEvents: UpgradeEvent[];
}

/** 角色交互变动 */
export interface CharacterInteraction {
  characters: string[];
  type: 'first_meet' | 'info_gain' | 'relation_change';
  description: string;
}

/** 伏笔变动 */
export interface HookChange {
  action: 'plant' | 'resolve';
  hookId?: string;
  description: string;
  expectedResolution?: number;
}

/** 世界状态变动 */
export interface WorldStateChange {
  category: 'location' | 'item' | 'body' | 'faction';
  description: string;
}

/** 升级事件 */
export interface UpgradeEvent {
  type: 'ability' | 'skill' | 'resource';
  description: string;
}
