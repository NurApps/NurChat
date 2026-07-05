import { useState, useRef, useCallback, useMemo, useEffect } from "react"

const EMOJI_CATEGORIES = [
  {
    name: "Частые",
    icon: "🕐",
    emojis: [] as string[],
  },
  {
    name: "Смайлики",
    icon: "😀",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃",
      "😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙",
      "🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🫢",
      "🫣","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫥",
      "😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴",
      "😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯",
      "🤠","🥳","🥸","😎","🤓","🧐","😕","🫤","😟","🙁",
      "😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰",
      "😥","😢","😭","😱","😖","😣","😞","😓","😩","😫",
      "🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩",
      "🤡","👹","👺","👻","👽","👾","🤖",
    ],
  },
  {
    name: "Жесты",
    icon: "👋",
    emojis: [
      "👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌",
      "🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉",
      "👆","🖕","👇","☝️","🫵","👍","👎","✊","👊","🤛",
      "🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","💪","🦾",
    ],
  },
  {
    name: "Люди",
    icon: "👤",
    emojis: [
      "👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓",
      "👴","👵","🙍","🙎","🙅","🙆","💁","🙋","🧏","🙇",
      "🤦","🤷","👮","🕵️","💂","🥷","👷","🫅","🤴","👸",
      "👳","👲","🧕","🤵","👰","🤰","🫃","🤱","👼","🎅",
      "🤶","🦸","🦹","🧙","🧚","🧛","🧜","👻","🧞","🧟",
    ],
  },
  {
    name: "Животные",
    icon: "🐶",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨",
      "🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊",
      "🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉",
      "🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌",
      "🐞","🐜","🪲","🪳","🦟","🦗","🕷️","🦂","🐢","🐍",
      "🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠",
      "🐟","🐬","🐳","🐋","🦈","🦭","🐊","🐅","🐆","🦓",
      "🦍","🦧","🐘","🦣","🦛","🦏","🐪","🐫","🦒","🦘",
      "🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐",
      "🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃",
      "🦤","🦚","🦜","🦢","🦩","🕊️","🐇","🦝","🦨","🦡",
      "🦫","🦦","🦥","🐁","🐀","🐿️","🦔","🐾",
    ],
  },
  {
    name: "Еда",
    icon: "🍔",
    emojis: [
      "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐",
      "🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑",
      "🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅",
      "🥔","🍠","🫘","🥐","🍞","🥖","🥨","🧀","🥚","🍳",
      "🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔",
      "🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗",
      "🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟",
      "🦪","🍤","🍙","🍚","🍘","🍥","🥮","🍢","🍡","🍧",
      "🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫",
      "🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","🫖","☕",
      "🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃",
      "🍸","🍹","🧉","🍾","🧊",
    ],
  },
  {
    name: "Активности",
    icon: "⚽",
    emojis: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱",
      "🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳",
      "🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷",
      "⛸️","🥌","🎿","🪂","🎮","🕹️","🎲","♟️","🎯","🎳",
      "🎪","🎨","🧵","🧶","🎭","🩰","🎼","🎵","🎶","🎹",
      "🥁","🪘","🎷","🎺","🪗","🎸","🪕","🎻","🎬","🎤",
      "🎧","📻","🎷","🪗","🎸","🎹","🎺","🎻",
    ],
  },
  {
    name: "Путешествия",
    icon: "✈️",
    emojis: [
      "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐",
      "🛻","🚚","🚛","🚜","🏍️","🛵","🚲","🛴","🛺","🚍",
      "🚘","🚖","🛞","🚡","🚠","🚟","🚃","🚋","🚞","🚝",
      "🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫",
      "🛬","🛩️","💺","🛰️","🚀","🛸","🚁","🛶","⛵","🚤",
      "🛥️","🛳️","⛴️","🚢","⚓","🪝","⛽","🚧","🚦","🚥",
      "🗺️","🗿","🗽","🗼","🏰","🏯","🏟️","🎡","🎢","🎠",
      "⛲","⛱️","🏖️","🏝️","🏜️","🌋","⛰️","🏔️","🗻","🏕️",
    ],
  },
  {
    name: "Объекты",
    icon: "💡",
    emojis: [
      "⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️","🖲️","🕹️",
      "🗜️","💽","💾","💿","📀","📼","📷","📸","📹","🎥",
      "📽️","🎞️","📞","☎️","📟","📠","📺","📻","🎙️","🎚️",
      "🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋",
      "🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️","💸","💵",
      "💴","💶","💷","🪙","💰","💳","🪪","💎","⚖️","🪜",
      "🧰","🪛","🔧","🔩","⚙️","🗜️","⛏️","🛠️","⚒️","🔨",
    ],
  },
  {
    name: "Символы",
    icon: "❤️",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
      "❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝",
      "💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️",
      "☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎",
      "♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️",
      "📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮",
      "🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎",
      "🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯",
      "💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗",
      "❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸",
      "🔱","⚜️","🔰","♻️","✅","🈯","💹","❇️","✳️","❎",
      "🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️","🛗",
      "🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚼","⚧️",
      "🚻","🚮","🎦","📶","🈁","🔣","ℹ️","🔤","🔡","🔠",
      "🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣",
      "4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣",
      "⏏️","▶️","⏸️","⏯️","⏹️","⏺️","⏭️","⏮️","⏩","⏪",
      "⏫","⏬","◀️","🔼","🔽","➡️","⬅️","⬆️","⬇️","↗️",
      "↘️","↙️","↖️","↕️","↔️","↪️","↩️","⤴️","⤵️","🔀",
      "🔁","🔂","🔄","🔃","🎵","🎶","➕","➖","➗","✖️",
      "🟰","♾️","💲","💱","™️","©️","®️","〰️","➰","➿",
      "🔚","🔙","🔛","🔝","🔜","✔️","☑️","🔘","🔴","🟠",
      "🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","🔸",
      "🔹","🔶","🔳","🔲","▪️","▫️","◾","◽","◼️","◻️",
      "🟥","🟧","🟨","🟩","🟦","🟪","⬛","⬜","🟫","🔈",
      "🔇","🔉","🔊","🔔","🔕","📣","📢",
    ],
  },
  {
    name: "Флаги",
    icon: "🏁",
    emojis: [
      "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️",
      "🇺🇸","🇬🇧","🇷🇺","🇩🇪","🇫🇷","🇪🇸","🇮🇹","🇯🇵",
      "🇰🇷","🇨🇳","🇧🇷","🇮🇳","🇨🇦","🇦🇺","🇲🇽","🇦🇷",
      "🇹🇷","🇸🇦","🇦🇪","🇮🇱","🇪🇬","🇿🇦","🇳🇬","🇰🇪",
      "🇺🇦","🇵🇱","🇳🇱","🇧🇪","🇨🇭","🇦🇹","🇸🇪","🇳🇴",
      "🇩🇰","🇫🇮","🇮🇪","🇵🇹","🇬🇷","🇨🇿","🇷🇴","🇭🇺",
      "🇧🇬","🇭🇷","🇷🇸","🇺🇿","🇰🇿","🇬🇪","🇦🇲","🇦🇿",
    ],
  },
]

const FREQUENT_KEY = "emoji_frequent"
const MAX_FREQUENT = 30

// Search keywords map: emoji -> search terms
const EMOJI_SEARCH_MAP: Record<string, string> = {
  "😀": "happy smile grin face",
  "😃": "happy smile smiley face",
  "😄": "happy smile laugh face",
  "😁": "grin beam face",
  "😆": "laugh tight smile",
  "😅": "sweat smile laugh face",
  "🤣": "rofl rolling laugh",
  "😂": "tears joy laugh cry",
  "🙂": "slightly smiling face",
  "🙃": "upside down face",
  "😉": "wink face",
  "😊": "blush smile happy face",
  "😇": "innocent angel halo",
  "🥰": "love face hearts",
  "😍": "heart eyes love face",
  "🤩": "star struck excited face",
  "😘": "kiss face love",
  "😗": "kissing face",
  "😚": "kissing closed eyes",
  "😙": "kissing smiling",
  "😋": "yum delicious face",
  "😛": "tongue face",
  "😜": "tongue wink face",
  "🤪": "crazy zany face",
  "😝": "tongue squint face",
  "🤑": "money face",
  "🤗": "hug embrace face",
  "🤭": "oops hand mouth",
  "🤫": "shush quiet face",
  "🤔": "thinking face",
  "🤐": "zipper mouth face",
  "🤨": "raised eyebrow face",
  "😐": "neutral face",
  "😑": "expressionless face",
  "😶": "no mouth face",
  "😏": "smirk face",
  "😒": "unamused face",
  "🙄": "eye roll face",
  "😬": "grimacing face",
  "🤥": "lying face nose",
  "😌": "relieved face",
  "😔": "pensive sad face",
  "😪": "sleepy face",
  "🤤": "drool face",
  "😴": "sleeping face",
  "😷": "sick mask face",
  "🤒": "thermometer sick face",
  "🤕": "head bandage hurt face",
  "🤢": "nauseated sick face",
  "🤮": "vomiting sick face",
  "🥵": "hot face sweating",
  "🥶": "cold face freezing",
  "🥴": "woozy face drunk",
  "😵": "dizzy face",
  "🤯": "mind blown exploding head",
  "🤠": "cowboy hat face",
  "🥳": "party face celebration",
  "😎": "cool sunglasses face",
  "🤓": "nerd face glasses",
  "🧐": "monocle face",
  "😕": "confused face",
  "😟": "worried face",
  "🙁": "slightly frowning face",
  "😮": "open mouth surprised face",
  "😯": "hushed surprised face",
  "😲": "astonished face",
  "😳": "flushed face embarrassed",
  "🥺": "pleading puppy eyes face",
  "😦": "frowning open mouth face",
  "😧": "anguished face",
  "😨": "fearful face scared",
  "😰": "anxious sweat face",
  "😥": "sad relieved face",
  "😢": "cry sad tears face",
  "😭": "loudly crying sobbing face",
  "😱": "scream fear face",
  "😖": "confounded face",
  "😣": "persevere face",
  "😞": "disappointed face sad",
  "😓": "downcast sweat face",
  "😩": "weary tired face",
  "😫": "tired exhausted face",
  "😤": "triumph steam nose face angry",
  "😡": "angry rage face mad",
  "😠": "angry face mad",
  "🤬": "swearing cursing face angry",
  "😈": "devil imp face",
  "👿": "angry devil imp face",
  "💀": "skull dead face",
  "💩": "poop pile poo face",
  "🤡": "clown face",
  "👹": "ogre monster face",
  "👺": "goblin face",
  "👻": "ghost spooky face",
  "👽": "alien ufo face",
  "👾": "alien monster face",
  "🤖": "robot face",
  "👋": "wave hello hand",
  "🤚": "raised backhand hand",
  "🖐️": "hand five fingers",
  "✋": "stop hand high five",
  "🖖": "vulcan hand star trek",
  "👌": "ok hand perfect",
  "🤌": "italian hand fingers",
  "🤏": "pinching hand small",
  "✌️": "peace victory hand",
  "🤞": "crossed fingers hope",
  "🤟": "love you hand sign",
  "🤘": "rock on hand horns",
  "🤙": "call me hand shaka",
  "👈": "point left hand",
  "👉": "point right hand",
  "👆": "point up hand finger",
  "👇": "point down hand finger",
  "☝️": "point up hand index",
  "👍": "thumbs up like good yes hand",
  "👎": "thumbs down dislike no hand",
  "✊": "fist raised power hand",
  "👊": "fist bump punch hand",
  "🤛": "fist left hand",
  "🤜": "fist right hand",
  "👏": "clap applause hands",
  "🙌": "raised hands celebration hallelujah",
  "👐": "open hands palms",
  "🤲": "palms up together hands",
  "🤝": "handshake deal hands",
  "🙏": "pray please hands namaste",
  "💪": "muscle strong bicep arm",
  "❤️": "heart love red like",
  "🧡": "orange heart love",
  "💛": "yellow heart love",
  "💚": "green heart love",
  "💙": "blue heart love",
  "💜": "purple heart love",
  "🖤": "black heart love",
  "🤍": "white heart love",
  "🤎": "brown heart love",
  "💔": "broken heart sad love",
  "❣️": "heart exclamation love",
  "💕": "two hearts love",
  "💞": "revolving hearts love",
  "💓": "beating heart pulse love",
  "💗": "growing heart love",
  "💖": "sparkling heart love",
  "💘": "heart arrow cupid love",
  "💝": "heart ribbon gift love",
  "💟": "heart decoration love",
  "☮️": "peace symbol",
  "✝️": "cross christianity religion",
  "☪️": "star crescent islam religion",
  "🕉️": "om hinduism religion",
  "☸️": "dharma wheel buddhism",
  "✡️": "star david judaism",
  "☯️": "yin yang balance",
  "✅": "check mark done complete yes ok",
  "❌": "cross mark no wrong",
  "⭕": "circle red complete",
  "🛑": "stop sign red",
  "⛔": "no entry forbidden",
  "📛": "name badge",
  "🚫": "prohibited forbidden no",
  "💯": "hundred perfect score",
  "🔴": "red circle dot",
  "🟠": "orange circle dot",
  "🟡": "yellow circle dot",
  "🟢": "green circle dot",
  "🔵": "blue circle dot",
  "🟣": "purple circle dot",
  "⚫": "black circle dot",
  "⚪": "white circle dot",
  "🟤": "brown circle dot",
  "☀️": "sun light bright day weather",
  "🌙": "moon night crescent",
  "⭐": "star favorite rating",
  "🌟": "glowing star bright",
  "✨": "sparkles stars shine",
  "⚡": "lightning bolt electric thunder",
  "🔥": "fire hot flame burn lit",
  "💧": "water drop sweat",
  "🌈": "rainbow color weather",
  "🎵": "music note song",
  "🎶": "music notes song melody",
  "🎤": "microphone karaoke sing",
  "🎧": "headphones music listen",
  "🎸": "guitar music instrument",
  "🎹": "piano keyboard music",
  "🎺": "trumpet music instrument",
  "🎻": "violin music instrument",
  "🥁": "drum music instrument",
  "⚽": "soccer football sport ball",
  "🏀": "basketball sport ball",
  "🏈": "american football sport ball",
  "⚾": "baseball sport ball",
  "🎾": "tennis sport ball",
  "🏐": "volleyball sport ball",
  "🎱": "billiards pool ball",
  "🏓": "ping pong table tennis sport",
  "🏸": "badminton sport",
  "🥊": "boxing glove sport fight",
  "🎯": "dart bullseye target goal",
  "⛳": "golf flag sport",
  "🎮": "video game controller play",
  "🕹️": "joystick game controller",
  "🎲": "dice game chance luck",
  "♟️": "chess pawn game",
  "🎨": "art palette paint creative",
  "🎭": "performing arts theater drama",
  "🎪": "circus tent carnival",
  "🎬": "clapperboard movie film",
  "📻": "radio music",
  "📱": "mobile phone smartphone",
  "💻": "laptop computer",
  "⌨️": "keyboard type",
  "🖥️": "desktop computer monitor",
  "🖨️": "printer",
  "🖱️": "computer mouse",
  "📷": "camera photo",
  "📸": "camera with flash photo",
  "📹": "video camera record",
  "🎥": "movie camera film",
  "📞": "phone receiver call",
  "☎️": "telephone call phone",
  "📺": "television tv",
  "⌚": "watch time",
  "⏰": "alarm clock time",
  "⏱️": "stopwatch time",
  "⏲️": "timer clock time",
  "⌛": "hourglass time",
  "⏳": "hourglass flowing time",
  "📡": "satellite antenna signal",
  "🔋": "battery power charge",
  "💡": "light bulb idea",
  "🔦": "flashlight light",
  "🕯️": "candle light",
  "🧯": "fire extinguisher",
  "💰": "money bag wealth",
  "💎": "gem diamond precious",
  "⚖️": "balance scale justice",
  "🔧": "wrench tool fix",
  "🔨": "hammer tool build",
  "⚙️": "gear settings system",
  "🗜️": "compression clamp",
  "⛏️": "pick mining tool",
  "🛠️": "hammer wrench tools",
  "⚒️": "hammer pick tools",
  "🔩": "nut bolt",
  "🧲": "magnet",
  "🧰": "toolbox",
  "🪛": "screwdriver",
  "🚗": "car automobile drive",
  "🚕": "taxi cab car",
  "🚙": "car suv automobile",
  "🚌": "bus public transport",
  "🏎️": "race car fast",
  "🚓": "police car",
  "🚑": "ambulance emergency",
  "🚒": "fire truck emergency",
  "🚐": "van minibus",
  "🛻": "pickup truck",
  "🚚": "delivery truck",
  "🚛": "truck lorry",
  "🚜": "tractor farm",
  "🏍️": "motorcycle motorbike",
  "🛵": "scooter motor scooter",
  "🚲": "bicycle bike",
  "🛴": "kick scooter",
  "✈️": "airplane plane flight travel",
  "🚀": "rocket space launch",
  "🛸": "ufo alien spaceship",
  "🚁": "helicopter",
  "🛶": "canoe kayak",
  "⛵": "sailboat boat sailing",
  "🚤": "speedboat boat fast",
  "🚢": "ship cruise boat",
  "⚓": "anchor boat sea",
  "⛽": "gas pump fuel station",
  "🗺️": "world map travel",
  "🏔️": "mountain nature",
  "⛰️": "mountain nature",
  "🌋": "volcano nature",
  "🏕️": "camping tent nature",
  "🏖️": "beach umbrella sea",
  "🏜️": "desert nature",
  "🏝️": "island tropical nature",
  "🏰": "castle building",
  "🏯": "japanese castle building",
  "🏟️": "stadium sport",
  "🎡": "ferris wheel amusement park",
  "🎢": "roller coaster amusement park",
  "⛲": "fountain water",
  "🗽": "statue liberty landmark",
  "🗼": "tower tokyo landmark",
  "🌉": "bridge night",
  "🌁": "foggy bridge",
  "🌃": "night city stars",
  "🌆": "city sunset",
  "🌇": "city sunrise",
  "🏭": "factory building industry",
  "-office": "office building work",
  "🏤": "post office building",
  "🏥": "hospital building medical",
  "🏦": "bank building money",
  "🏨": "hotel building",
  "🏩": "love hotel building",
  "🏪": "store shop building",
  "🏫": "school building education",
  "🏬": "department store shopping",
  "💒": "wedding church love",
  "⛪": "church building religion",
  "🕌": "mosque building religion",
  "🛕": "hindu temple religion",
  "🕍": "synagogue building religion",
  "⛩️": "shinto shrine religion",
  "🕋": "kaaba muslim religion",
  "🕐": "clock one time",
  "🕑": "clock two time",
  "🕒": "clock three time",
  "🕓": "clock four time",
  "🕔": "clock five time",
  "🕕": "clock six time",
  "🕖": "clock seven time",
  "🕗": "clock eight time",
  "🕘": "clock nine time",
  "🕙": "clock ten time",
  "🕚": "clock eleven time",
  "🕛": "clock twelve time",
  "🏳️": "white flag",
  "🏴": "black flag",
  "🏁": "checkered flag finish race",
  "🚩": "red flag",
  "🎌": "crossed flags japan",
}

function getFrequentEmojis(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FREQUENT_KEY) || "[]")
  } catch {
    return []
  }
}

function saveFrequentEmoji(emoji: string) {
  const freq = getFrequentEmojis().filter((e) => e !== emoji)
  freq.unshift(emoji)
  if (freq.length > MAX_FREQUENT) freq.length = MAX_FREQUENT
  localStorage.setItem(FREQUENT_KEY, JSON.stringify(freq))
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const categoryRefs = useRef<(HTMLDivElement | null)[]>([])
  const gridContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // IntersectionObserver for scroll-based category tracking
  useEffect(() => {
    if (search || !gridContainerRef.current) return
    const container = gridContainerRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = categoryRefs.current.indexOf(entry.target as HTMLDivElement)
            if (idx >= 0) setActiveCategory(idx)
          }
        }
      },
      { root: container, threshold: 0.3 }
    )
    categoryRefs.current.forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [search])

  const filteredEmojis = useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    const results: { emoji: string; category: string }[] = []
    for (const cat of EMOJI_CATEGORIES) {
      for (const emoji of cat.emojis) {
        const keywords = EMOJI_SEARCH_MAP[emoji] || ""
        if (emoji.includes(q) || keywords.toLowerCase().includes(q)) {
          results.push({ emoji, category: cat.name })
        }
      }
    }
    return results
  }, [search])

  const handleSelect = useCallback((emoji: string) => {
    saveFrequentEmoji(emoji)
    onSelect(emoji)
  }, [onSelect])

  const categoriesWithFrequent = useMemo(() => {
    const cats = [...EMOJI_CATEGORIES]
    cats[0].emojis = getFrequentEmojis()
    return cats
  }, [])

  return (
    <div className="emoji-picker" ref={containerRef}>
      <div className="emoji-header">
        <input
          ref={searchRef}
          className="emoji-search"
          type="text"
          placeholder="Поиск эмодзи..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="emoji-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {search ? (
        <div className="emoji-grid-container">
          <div className="emoji-grid">
            {filteredEmojis?.map((item, i) => (
              <button
                key={`${item.emoji}-${i}`}
                className="emoji-btn"
                onClick={() => handleSelect(item.emoji)}
                title={item.emoji}
              >
                {item.emoji}
              </button>
            ))}
            {filteredEmojis?.length === 0 && (
              <p className="emoji-empty">Ничего не найдено</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="emoji-categories">
            {categoriesWithFrequent.map((cat, i) => (
              <button
                key={cat.name}
                className={`emoji-cat-btn ${i === activeCategory ? "active" : ""}`}
                onClick={() => {
                  setActiveCategory(i)
                  categoryRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
                title={cat.name}
              >
                {cat.icon}
              </button>
            ))}
          </div>
          <div className="emoji-grid-container" ref={gridContainerRef}>
            {categoriesWithFrequent.map((cat, i) => (
              <div
                key={cat.name}
                className="emoji-category-section"
                ref={(el) => { categoryRefs.current[i] = el }}
              >
                <div className="emoji-category-title">{cat.name}</div>
                <div className="emoji-grid">
                  {cat.emojis.map((emoji) => (
                    <button
                      key={`${cat.name}-${emoji}`}
                      className="emoji-btn"
                      onClick={() => handleSelect(emoji)}
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
