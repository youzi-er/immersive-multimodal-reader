export const clues = [
  {
    id: 'clue-bell-rope',
    label: '无效的拉铃绳',
    type: '线索',
    description: '看似用于叫仆人，实际没有连接任何铃铛，位置却正好垂在床边。'
  },
  {
    id: 'clue-ventilator',
    label: '异常通风口',
    type: '线索',
    description: '通风口没有通向室外，而是连接到隔壁房间，说明它可能不是为了通风。'
  },
  {
    id: 'clue-fixed-bed',
    label: '固定在地板上的床',
    type: '线索',
    description: '床不能移动，意味着受害者每晚都会处在同一个固定位置。'
  },
  {
    id: 'clue-whistle',
    label: '夜间短哨声',
    type: '线索',
    description: '短促的哨声反复出现在深夜，像是某种训练信号。'
  },
  {
    id: 'place-stoke-moran',
    label: '斯托克莫兰庄园',
    type: '地点',
    description: '案件发生地，老旧、封闭，房间结构隐藏了关键作案路径。'
  },
  {
    id: 'person-holmes',
    label: '夏洛克·福尔摩斯',
    type: '人物',
    description: '通过观察物理细节和异常设计，逐步还原案件真相。'
  }
];

export const chapters = [
  {
    id: 'speckled-band-1',
    title: '斑点带子案：清晨来客',
    subtitle: '贝克街的求助',
    progress: 18,
    paragraphs: [
      [
        {
          type: 'narration',
          text: '清晨的伦敦还笼罩在薄雾里，贝克街 221B 的壁炉发出微弱的红光。华生刚醒来，便看见福尔摩斯已经穿戴整齐，正站在窗前观察街角的马车。'
        }
      ],
      [
        {
          type: 'narration',
          text: '门铃忽然响起。一位面色苍白、神情紧张的年轻女士走进房间。她的手套边缘被攥得变形，说明她一路上都处在极度不安之中。'
        }
      ],
      [
        {
          type: 'dialogue',
          speaker: '海伦·斯托纳',
          text: '先生，我姐姐临死前只说出了一个词：斑点带子。如今，同样的夜晚声响又出现在我的房间附近。',
          voice: { pitch: 1.12, rate: 0.92 }
        }
      ],
      [
        {
          type: 'dialogue',
          speaker: '福尔摩斯',
          text: '请从头讲起，不要省略任何看似微小的细节。案件里最危险的部分，往往藏在最普通的物件后面。',
          voice: { pitch: 0.82, rate: 0.95 }
        }
      ]
    ],
    scene: {
      title: '贝克街清晨会面',
      imagePrompt: '维多利亚时代伦敦，雾气、壁炉、侦探公寓、紧张的委托人，暗色写实风格。',
      mood: '冷雾、压迫、理性推理开始前的紧张',
      soundscape: '壁炉轻响、远处马车、清晨街道脚步声'
    }
  },
  {
    id: 'speckled-band-2',
    title: '斑点带子案：庄园调查',
    subtitle: '异常的卧室',
    progress: 47,
    paragraphs: [
      [
        {
          type: 'narration',
          text: '福尔摩斯在庄园房间内缓慢踱步。他没有急于下结论，而是依次检查床、通风口、拉铃绳和隔壁房间的墙面。'
        }
      ],
      [
        {
          type: 'narration',
          text: '他先伸手拉了拉床边的绳子。'
        },
        {
          type: 'clue',
          clueId: 'clue-bell-rope',
          text: '那条拉铃绳看似普通，却并没有连接到任何铃。'
        },
        {
          type: 'narration',
          text: '接着，他又俯身检查床脚。'
        },
        {
          type: 'clue',
          clueId: 'clue-fixed-bed',
          text: '床被固定在地板上，无法移动到房间的其他位置。'
        }
      ],
      [
        {
          type: 'dialogue',
          speaker: '福尔摩斯',
          text: '华生，你注意到了吗？如果床不能移动，而绳子又没有真正用途，那么它们的位置就不是偶然。',
          voice: { pitch: 0.82, rate: 0.92 }
        }
      ],
      [
        {
          type: 'narration',
          text: '福尔摩斯的眼神在墙上停留了片刻。'
        },
        {
          type: 'clue',
          clueId: 'clue-ventilator',
          text: '通风口没有通向室外，而是连接到隔壁房间。'
        },
        {
          type: 'dialogue',
          speaker: '福尔摩斯',
          text: '今晚我们必须保持清醒。真正的答案，会从这个方向出现。',
          voice: { pitch: 0.82, rate: 0.9 }
        }
      ]
    ],
    scene: {
      title: '斯托克莫兰庄园卧室',
      imagePrompt: '老旧英国庄园卧室，固定床、无效拉铃绳、墙上通风口，悬疑推理氛围。',
      mood: '安静、诡异、线索正在连接',
      soundscape: '木地板轻响、风穿过窗缝、远处犬吠'
    }
  },
  {
    id: 'speckled-band-3',
    title: '斑点带子案：夜间守候',
    subtitle: '真相逼近',
    progress: 76,
    paragraphs: [
      [
        {
          type: 'narration',
          text: '夜色降临后，福尔摩斯和华生悄悄进入房间。灯被熄灭，屋内只剩下几乎不可察觉的呼吸声。'
        }
      ],
      [
        {
          type: 'clue',
          clueId: 'clue-whistle',
          text: '黑暗中，一阵轻微的金属摩擦声传来。随后，是一种极低、极短的哨声。'
        }
      ],
      [
        {
          type: 'dialogue',
          speaker: '华生',
          text: '福尔摩斯，你听见了吗？那声音就在墙的另一边。',
          voice: { pitch: 1.0, rate: 0.96 }
        }
      ],
      [
        {
          type: 'narration',
          text: '福尔摩斯突然点亮火柴，手杖迅速击向拉铃绳附近。那一刻，所有看似无关的细节终于合为完整的答案。'
        }
      ]
    ],
    scene: {
      title: '黑暗中的守候',
      imagePrompt: '夜晚庄园卧室，侦探和医生隐藏在黑暗里，火柴微光照亮危险线索。',
      mood: '高度紧张、危险、真相揭晓前一秒',
      soundscape: '低哨声、金属摩擦、急促呼吸'
    }
  }
];
