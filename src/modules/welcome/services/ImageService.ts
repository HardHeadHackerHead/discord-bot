import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Welcome:ImageService');

// Storage directory for welcome images
const IMAGE_STORAGE_DIR = join(process.cwd(), 'data', 'welcome-images');

// State file for prompt cycler persistence
const CYCLER_STATE_FILE = join(process.cwd(), 'data', 'welcome-prompt-state.json');

// Standard instruction to preserve likeness - prepended to all prompts
const LIKENESS_INSTRUCTION = `CRITICAL REQUIREMENT: If the input image contains a person's face, photo, or character (anime, cartoon, mascot, etc.), you MUST preserve and use their EXACT likeness, facial features, distinctive traits, and appearance. The subject in the output image must be clearly recognizable as the same person or character from the input. Transform them into the scene while keeping their face and identity intact. Do NOT generate a generic or different person/character - use THIS specific subject's face and likeness. `;

// OpenAI pricing estimates (USD) - updated for low quality
const PRICING = {
  'gpt-image-1': 0.02,      // ~$0.02 per image edit at low quality
  'dall-e-3-hd': 0.08,      // $0.080 per 1024x1024 HD image
  'dall-e-3-hd-wide': 0.12, // $0.120 per 1792x1024 HD image
};

// Canvas dimensions - widescreen format for Discord embeds
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;
const AVATAR_SIZE = 200;

// OpenAI image settings
const AI_IMAGE_SIZE = '1536x1024';  // Wide landscape for full scene
const AI_IMAGE_QUALITY = 'low';     // 'low', 'medium', or 'high' - low for maximum cost savings

// Array of scientist prompts for variety
// These are designed to work with both human photos AND non-human avatars (logos, anime, etc.)
const SCIENTIST_PROMPTS = [
  // ===== MAD SCIENTIST VIBES (1-8) =====

  // 1. Classic underground lab
  `Transform this image into a chaotic mad scientist scene in an underground laboratory. If it's a person, make them look unhinged and brilliant with wild hair and crazed expression. If it's a logo or non-human image, incorporate it as a glowing holographic emblem on the scientist's lab coat or as the face of the mad scientist themselves. Surround with bubbling beakers, Tesla coils sparking electricity, mysterious glowing experiments gone wrong, smoke and steam everywhere. Dramatic neon green and electric purple lighting. Cyberpunk mad scientist aesthetic.`,

  // 2. Explosion moment
  `Create a dramatic scene where this image becomes a mad scientist at the exact moment an experiment explodes. If it's a person, capture their manic glee. If it's a logo or character, make it the scientist's face or a glowing symbol on their chest. Background should have an explosion of colorful chemicals, shattered glass flying, sparks everywhere, with the scientist laughing maniacally. Neon cyan and orange lighting cutting through smoke. Cinematic widescreen composition.`,

  // 3. Frankenstein moment
  `Create a dramatic "IT'S ALIVE!" moment with this image. If it's a person, show them as a wild-eyed scientist pulling a giant lever, electricity arcing everywhere. If it's a logo or non-human image, make it glow on the scientist's equipment or as the face of the creation coming to life. Laboratory filled with Jacob's ladders, Van de Graaff generators, mysterious tubes with bubbling liquid. Green and white electrical lighting illuminating the chaos.`,

  // 4. Shrink ray operator
  `Transform this into a mad scientist operating a massive shrink ray device. If it's a person, show them with goggles and wild excitement, aiming at miniaturized objects. If it's a logo or non-human image, make it the targeting reticle or energy source of the ray. Giant control panels, shrinking beams, tiny shrunken objects on the table, oversized machinery. Retro sci-fi green and yellow ray gun aesthetics.`,

  // 5. Brain experiment
  `Create a scene of a deranged neuroscientist with brains in glowing jars. If it's a person, show them examining neural activity with fascinated intensity. If it's a logo or non-human image, make it appear as a pattern in the neural activity or on monitoring equipment. Walls of specimen jars, electrodes, brain wave monitors, floating synaptic connections. Eerie green and pink bioluminescent lighting.`,

  // 6. Giant robot controller
  `Transform this into a scientist controlling a massive robot from a command chair. If it's a person, show them in a neural link helmet, eyes glowing with connection. If it's a logo or non-human image, make it the robot's face or chest emblem. Huge mech visible through windows, holographic control interfaces, warning lights, industrial lab setting. Red alert lighting mixed with cool blue control screens.`,

  // 7. Mutation experiment
  `Create a scene of a geneticist surrounded by bizarre mutated creatures in containment. If it's a person, show them with clipboard, studying the specimens with clinical detachment. If it's a logo or non-human image, incorporate it into the creatures' patterns or containment displays. Glass tanks with strange life forms, mutation charts, biohazard warnings. Sickly green and amber lighting.`,

  // 8. Weather control
  `Transform this into a scientist controlling weather from a storm laboratory. If it's a person, show them commanding lightning and clouds with raised hands. If it's a logo or non-human image, make it appear in the storm clouds or on weather control equipment. Massive tesla coils, swirling miniature storms, rain and lightning inside the lab. Electric blue and purple storm lighting.`,

  // ===== FUTURISTIC / CLEAN SCIENTIST VIBES (9-16) =====

  // 9. Sleek future lab
  `Transform this image into a brilliant scientist in a pristine futuristic laboratory. If it's a person, give them a sleek white lab coat with subtle glowing accents, confident expression, holographic data floating around them. If it's a logo or non-human image, make it a glowing badge on their coat or a hologram they're analyzing. Clean minimalist lab with floating screens, transparent displays, soft blue and white ambient lighting. Apple-store-meets-science-lab aesthetic.`,

  // 10. Quantum physicist
  `Create a scene of a quantum physicist manipulating reality itself. If it's a person, show them calmly controlling floating quantum particles and probability waves with elegant hand gestures. If it's a logo or non-human image, incorporate it as a quantum signature or particle pattern they're studying. Visualization of quantum superposition, entangled particles, wave functions collapsing. Deep blue and violet ethereal lighting with particle effects.`,

  // 11. AI researcher
  `Transform this into an AI researcher in a cutting-edge neural network lab. If it's a person, show them interfacing with a massive AI visualization, data streams reflected in their glasses. If it's a logo or non-human image, make it the core of the AI system or displayed on floating monitors. Towering server racks with pulsing lights, neural network visualizations, holographic brain structures. Cool blue and cyan tech lighting.`,

  // 12. Hologram designer
  `Create a scene of a scientist crafting intricate holograms with precise hand movements. If it's a person, show them sculpting light itself, surrounded by floating 3D projections. If it's a logo or non-human image, make it one of the holograms being designed. Holographic displays at various stages, light refraction patterns, floating geometric shapes. Rainbow prismatic lighting effects.`,

  // 13. Nanotech engineer
  `Transform this into a nanotechnology specialist working at molecular scale. If it's a person, show them viewing massive magnified displays of nanobots. If it's a logo or non-human image, make it the nanobot swarm pattern or control interface. Microscopic views on huge screens, nanobot assembly lines, molecular structures, clean room environment. Silver and electric blue sterile lighting.`,

  // 14. Medical futurist
  `Create a scene of a future surgeon in an advanced medical pod. If it's a person, show them performing delicate holographic surgery, robotic arms assisting. If it's a logo or non-human image, make it the medical interface or patient vitals display. Floating organ holograms, precision laser tools, biometric displays, sterile white environment. Soft blue surgical lighting with red vital indicators.`,

  // 15. Crystal energy researcher
  `Transform this into a scientist studying massive energy crystals. If it's a person, show them analyzing crystalline structures radiating power. If it's a logo or non-human image, make it glow within the crystal or appear as energy patterns. Giant glowing crystals, energy conduits, refraction patterns, power meters. Vibrant crystal colors - pink, blue, purple energy glow.`,

  // 16. Gravity manipulator
  `Create a scene of a physicist experimenting with artificial gravity. If it's a person, show them floating amidst objects defying physics. If it's a logo or non-human image, make it the center of a gravity distortion. Objects floating at various angles, gravity field visualizations, orientation-defying room design. Blue-white antigravity glow against dark lab.`,

  // ===== SPACE / COSMIC SCIENTIST VIBES (17-26) =====

  // 17. Space station scientist
  `Create a scene of a scientist aboard a futuristic space station. If it's a person, show them in a sleek spacesuit or lab coat, gazing at experiments with Earth or a nebula visible through massive windows behind them. If it's a logo or non-human image, make it a mission patch or holographic display they're studying. Zero-gravity lab equipment, floating droplets, holographic star charts. Dramatic lighting from space with blue and purple cosmic hues.`,

  // 18. Alien artifact researcher
  `Transform this into a xenoarchaeologist studying an ancient alien artifact. If it's a person, show their face illuminated by mysterious glowing symbols emanating from the artifact. If it's a logo or non-human image, incorporate it AS the alien artifact or symbols on it. Dark research chamber, floating alien glyphs, strange geometric structures, scanning equipment. Otherworldly teal and gold lighting.`,

  // 19. Planetary scientist
  `Create a scene of a planetary scientist on an alien world. If it's a person, show them in an advanced exploration suit, analyzing strange flora or geological formations. If it's a logo or non-human image, make it a holographic scan result or emblem on their suit. Alien landscape with unusual colors, orbiting moons visible, research drones, sample containers. Dramatic sunset lighting with alien sky colors.`,

  // 20. Black hole researcher
  `Transform this into an astrophysicist studying a contained black hole. If it's a person, show them in awe before the swirling accretion disk. If it's a logo or non-human image, make it appear being stretched by gravitational lensing. Massive containment field, event horizon visualization, spaghettification warnings, space-time distortion effects. Dark void with bright orange-white accretion disk lighting.`,

  // 21. Asteroid miner
  `Create a scene of a space geologist in an asteroid mining station. If it's a person, show them analyzing rare minerals with excited discovery. If it's a logo or non-human image, make it a mining company logo or mineral scanner display. Floating rock samples, mining lasers, precious element readouts, asteroid field visible outside. Industrial orange and metallic lighting.`,

  // 22. Terraforming specialist
  `Transform this into an engineer monitoring planetary terraformation. If it's a person, show them before massive holographic planet displays showing transformation progress. If it's a logo or non-human image, make it the terraforming company emblem or atmospheric readout. Planet cross-sections, atmosphere generators, timeline projections, before/after comparisons. Green growth colors against barren red/brown.`,

  // 23. Starship engineer
  `Create a scene of an engineer in a starship's engine room. If it's a person, show them calibrating a glowing warp core or hyperdrive. If it's a logo or non-human image, make it the ship's insignia or power core display. Massive engine components, plasma conduits, engineering displays, crew in background. Warm orange engine glow with cool blue readouts.`,

  // 24. First contact specialist
  `Transform this into a xenolinguist making first contact with alien beings. If it's a person, show them calmly communicating through translation devices. If it's a logo or non-human image, make it part of the translation interface or alien communication patterns. Alien silhouettes, universal translator displays, peaceful diplomatic setting in space. Soft welcoming light mixed with alien bioluminescence.`,

  // 25. Nebula researcher
  `Create a scene of an astronomer inside a nebula study vessel. If it's a person, show them surrounded by swirling cosmic gases and newborn stars. If it's a logo or non-human image, make it appear formed from nebula dust. Colorful gas clouds everywhere, stellar nursery views, spectral analysis displays. Vibrant nebula colors - pink, purple, blue cosmic glow.`,

  // 26. Dark matter detector
  `Transform this into a physicist operating a dark matter detection array. If it's a person, show them monitoring exotic particle traces in deep space. If it's a logo or non-human image, make it the pattern of dark matter interactions. Massive detector arrays, invisible force visualizations, deep underground or deep space setting. Ultraviolet detection glow against absolute darkness.`,

  // ===== CYBERPUNK / TECH SCIENTIST VIBES (27-36) =====

  // 27. Cyberpunk hacker lab
  `Transform this into a cyberpunk hacker-scientist in a neon-lit tech lab. If it's a person, give them glowing cybernetic implants and holographic displays reflected in their eyes. If it's a logo or non-human image, make it a glowing mask or helmet the scientist wears, or a hologram they're manipulating. Multiple monitors with code, floating holographic data, cables everywhere. Electric blue and hot pink neon lighting.`,

  // 28. Robotics engineer
  `Create a scene of a robotics engineer working on an advanced android. If it's a person, show them carefully adjusting neural circuits with precision tools, sparks flying. If it's a logo or non-human image, make it the android's face plate or a holographic schematic. Workshop filled with robot parts, glowing circuits, mechanical arms, diagnostic displays. Warm workshop lighting mixed with cool blue tech accents.`,

  // 29. Virtual reality architect
  `Transform this into a VR architect designing digital worlds from within cyberspace. If it's a person, show them wearing sleek VR gear, hands sculpting glowing virtual structures. If it's a logo or non-human image, make it a signature element in the virtual world they're creating. Digital grid landscapes, impossible architecture forming, data particles, code rain. Vibrant neon colors against dark digital void.`,

  // 30. Drone swarm commander
  `Create a scene of a scientist controlling hundreds of synchronized drones. If it's a person, show them conducting the swarm like an orchestra with gesture controls. If it's a logo or non-human image, make it the swarm formation pattern or command interface. Hundreds of small drones, formation patterns, tracking displays, warehouse or outdoor setting. LED indicator lights creating patterns in darkness.`,

  // 31. Cybernetic surgeon
  `Transform this into a specialist installing cybernetic enhancements. If it's a person, show them performing precise augmentation surgery, half-human half-machine patient visible. If it's a logo or non-human image, make it the cybernetic implant design or surgical interface. Chrome and flesh merged, glowing implants, surgical suite, enhancement catalogs. Clinical white with cyan cybernetic glow.`,

  // 32. Data archaeologist
  `Create a scene of a scientist excavating ancient digital data. If it's a person, show them reconstructing corrupted information from old servers. If it's a logo or non-human image, make it emerge from corrupted data streams. Ancient computer hardware, data visualization of recovered files, digital artifacts. Retro green terminal glow mixed with modern holographics.`,

  // 33. Network architect
  `Transform this into a scientist visualizing the entire global network. If it's a person, show them standing within a massive 3D map of connected nodes. If it's a logo or non-human image, make it a key node in the network. Globe-spanning connection lines, data packets flowing, network topology visualization. Blue connection lines against dark global map.`,

  // 34. Mech pilot engineer
  `Create a scene of a scientist in a mech suit calibration bay. If it's a person, show them connected to neural interfaces, testing movement synchronization. If it's a logo or non-human image, make it the mech's insignia or HUD display. Giant mechanical suit, neural link cables, motion capture sensors, combat simulations. Industrial amber with green HUD elements.`,

  // 35. Biometric security expert
  `Transform this into a specialist developing advanced biometric systems. If it's a person, show them surrounded by retinal scans, fingerprints, and DNA helixes. If it's a logo or non-human image, make it the central identification pattern. Multiple biometric displays, security clearance levels, identification algorithms. Red security lighting with green verification glow.`,

  // 36. Quantum computer programmer
  `Create a scene of a scientist programming a massive quantum computer. If it's a person, show them manipulating qubits represented as glowing spheres. If it's a logo or non-human image, make it the quantum state visualization. Supercooled quantum processors, probability clouds, entanglement diagrams. Ice blue cold environment with warm golden qubits.`,

  // ===== BIOTECH / NATURE SCIENTIST VIBES (37-46) =====

  // 37. Biotech geneticist
  `Create a scene of a geneticist working with glowing DNA sequences. If it's a person, show them manipulating a massive holographic double helix, gene sequences floating around. If it's a logo or non-human image, incorporate it into the DNA pattern or as a genetic marker display. Clean biotech lab, petri dishes with bioluminescent organisms, growth chambers. Soft green and blue bioluminescent lighting.`,

  // 38. Deep sea researcher
  `Transform this into a marine scientist in a deep sea research station. If it's a person, show them observing bioluminescent creatures through a massive observation dome. If it's a logo or non-human image, make it glow like a deep sea organism or appear on their diving suit. Underwater lab, strange glowing fish, pressure gauges, sonar displays. Deep blue darkness with bioluminescent accents.`,

  // 39. Jungle botanist
  `Create a scene of a botanist in a bioluminescent alien jungle. If it's a person, show them documenting glowing plants with scientific instruments. If it's a logo or non-human image, make it appear as a pattern on exotic flora. Massive glowing mushrooms, luminescent vines, floating spores, specimen collection. Natural greens and blues with bioluminescent highlights.`,

  // 40. Paleontologist
  `Transform this into a paleontologist with holographic dinosaur reconstructions. If it's a person, show them walking among life-size prehistoric projections. If it's a logo or non-human image, make it a fossil pattern or museum display. Complete skeleton holograms, dig site equipment, ancient DNA samples, museum lab setting. Amber fossil lighting with blue holographic dinosaurs.`,

  // 41. Entomologist
  `Create a scene of an insect scientist in a massive terrarium lab. If it's a person, show them observing giant projected insects with magnification goggles. If it's a logo or non-human image, make it an insect wing pattern or compound eye view. Oversized insect displays, terrariums, anatomical diagrams, collection cases. Natural lighting with specimen spotlight accents.`,

  // 42. Mycologist
  `Transform this into a fungi researcher in a bioluminescent mushroom cavern. If it's a person, show them sampling glowing spores with containment equipment. If it's a logo or non-human image, make it a spore pattern or mycelium network. Giant glowing mushrooms, underground lab, spore clouds, fungal networks visualized. Ethereal purple and blue fungal bioluminescence.`,

  // 43. Arctic researcher
  `Create a scene of a scientist in an ice core research station. If it's a person, show them analyzing ancient ice samples with climate data projections. If it's a logo or non-human image, make it frozen within the ice or appear on cold-weather gear. Ice cores, frozen specimens, climate graphs, aurora visible outside. Cold blue and white with warm equipment lighting.`,

  // 44. Volcanic geologist
  `Transform this into a geologist at an active volcano research station. If it's a person, show them in heat-resistant gear, analyzing lava samples. If it's a logo or non-human image, make it appear in the lava flow patterns or monitoring displays. Lava flows, seismic equipment, heat shields, magma samples. Intense orange and red volcanic glow.`,

  // 45. Coral reef biologist
  `Create a scene of a marine biologist in an underwater coral research dome. If it's a person, show them surrounded by vibrant coral and tropical fish. If it's a logo or non-human image, make it part of the coral pattern or research buoy. Colorful coral formations, fish swimming by, underwater equipment, bubble streams. Tropical aqua and coral color palette.`,

  // 46. Carnivorous plant researcher
  `Transform this into a botanist studying giant carnivorous plants. If it's a person, show them carefully feeding specimens while taking notes. If it's a logo or non-human image, make it the pattern on a venus flytrap or pitcher plant. Massive flytraps, sundews, pitcher plants, feeding schedules, growth chambers. Green and red warning colors with humid greenhouse atmosphere.`,

  // ===== MYSTICAL / EXOTIC SCIENTIST VIBES (47-56) =====

  // 47. Potion master
  `Transform this into an alchemist-style scientist surrounded by impossible potions. If it's a person, show them examining a swirling concoction with scientific curiosity. If it's a logo or character, incorporate it as a mystical symbol floating above the brew or on their equipment. Shelves of bizarre ingredients, floating orbs, smoke in impossible colors, beakers filled with galaxy-like swirling liquids. Purple and teal magical lighting.`,

  // 48. Dimension researcher
  `Create a scene where this image becomes a scientist studying a stable portal to another dimension. If it's a person, show their face lit by the otherworldly glow, taking notes with calm fascination. If it's a logo or non-human image, make it emerge from the portal or appear as readings on their instruments. Contained dimensional breach, monitoring equipment, reality distortion effects. Contrast of warm orange portal light against cool blue lab lighting.`,

  // 49. Time scientist
  `Transform this into a temporal physicist surrounded by time dilation effects. If it's a person, show multiple ghost images of them at different moments, calmly studying temporal anomalies. If it's a logo or non-human image, make it appear fragmented across different time states. Clocks showing different times, objects frozen mid-motion, temporal distortion waves. Golden and silver lighting with motion blur effects.`,

  // 50. Crystal mage scientist
  `Create a scene of a scientist channeling energy through magical crystals. If it's a person, show them in a trance state, crystals orbiting around them. If it's a logo or non-human image, make it glow at the center of a crystal formation. Floating gemstones, energy conduits, runic equations, mystical-meets-technical equipment. Prismatic crystal rainbow lighting.`,

  // 51. Dream researcher
  `Transform this into an oneirologist studying dreams in a sleep lab. If it's a person, show them monitoring surreal dreamscapes on displays, connected to sleeping subjects. If it's a logo or non-human image, make it appear within the dream visualization. Dream clouds, REM monitors, surreal imagery on screens, peaceful subjects. Soft purple and silver dreamlike lighting.`,

  // 52. Spirit analyzer
  `Create a scene of a paranormal scientist with ghost detection equipment. If it's a person, show them calmly analyzing spectral energy patterns. If it's a logo or non-human image, make it the ghostly apparition being studied. EMF readers, spirit photography, containment fields, ectoplasmic samples. Eerie green spectral glow against dark lab.`,

  // 53. Elemental controller
  `Transform this into a scientist commanding the four elements in containment fields. If it's a person, show them orchestrating fire, water, earth, and air samples. If it's a logo or non-human image, make it the elemental convergence point. Separate elemental chambers, control gauntlets, elemental fusion experiments. Four-color elemental lighting converging.`,

  // 54. Void researcher
  `Create a scene of a scientist studying the void between realities. If it's a person, show them at the edge of absolute nothingness, taking measurements. If it's a logo or non-human image, make it the only light in the darkness. Emptiness visualization, existence/non-existence boundary, philosophical equations. Light emerging from perfect darkness.`,

  // 55. Luck probability scientist
  `Transform this into a researcher manipulating probability itself. If it's a person, show them surrounded by floating dice, cards, and probability waves. If it's a logo or non-human image, make it the center of probability collapse. Schrödinger equipment, probability clouds, lucky/unlucky outcomes displayed, quantum randomness. Gold and silver chance-based lighting.`,

  // 56. Soul energy researcher
  `Create a scene of a scientist studying life force energy. If it's a person, show them observing glowing soul-like wisps with reverence and curiosity. If it's a logo or non-human image, make it a concentrated soul energy pattern. Ethereal wisps, life force meters, spiritual containment, peaceful atmosphere. Warm golden and white spiritual glow.`,

  // ===== STEAMPUNK / VICTORIAN SCIENTIST (57-64) =====

  // 57. Victorian inventor
  `Transform this into a Victorian-era inventor in a brass and wood laboratory. If it's a person, give them period clothing with goggles and a magnificent mustache or elegant styling. If it's a logo or non-human image, make it an engraved brass emblem or gear pattern. Brass instruments, wooden cabinets, gas lamps, leather-bound journals, early electrical equipment. Warm amber gaslight with copper accents.`,

  // 58. Clockwork engineer
  `Create a scene of a master clockmaker surrounded by intricate automatons. If it's a person, show them adjusting tiny gears with jeweler's precision. If it's a logo or non-human image, make it the face of a clockwork automaton. Thousands of gears, mechanical birds and figures, precision tools, ticking everywhere. Golden brass and copper mechanical lighting.`,

  // 59. Steam-powered lab
  `Transform this into a scientist in a massive steam-powered research facility. If it's a person, show them pulling levers and adjusting valves, steam billowing. If it's a logo or non-human image, make it appear on pressure gauges or boiler plates. Massive boilers, pressure gauges, pneumatic tubes, leather and brass aesthetic. Warm steam and fire glow with industrial shadows.`,

  // 60. Airship navigator
  `Create a scene of a scientist-explorer aboard a magnificent airship. If it's a person, show them charting courses with brass instruments, clouds visible through portholes. If it's a logo or non-human image, make it the airship's figurehead or navigation emblem. Brass telescopes, leather maps, altitude gauges, propeller views. Sky blue and brass golden hour lighting.`,

  // 61. Ether researcher
  `Transform this into a Victorian scientist studying the luminiferous ether. If it's a person, show them with antique equipment detecting invisible forces. If it's a logo or non-human image, make it manifest in the ether visualization. Crookes tubes, ether detection apparatus, spiritual photography equipment. Ghostly violet and sepia Victorian atmosphere.`,

  // 62. Analytical engine programmer
  `Create a scene of a computing pioneer with a massive mechanical computer. If it's a person, show them feeding punch cards into an enormous brass calculating machine. If it's a logo or non-human image, make it the output pattern or mechanical display. Giant gear-based computer, punch cards, mechanical readouts, computation in progress. Amber calculation lighting with mechanical rhythm.`,

  // 63. Galvanic experimenter
  `Transform this into a scientist conducting electricity experiments on specimens. If it's a person, show them with Leyden jars and galvanic batteries, dramatic sparks. If it's a logo or non-human image, make it the electrical arc pattern. Early batteries, specimen jars, twitching experiments, dramatic electrical arcs. Blue-white electrical discharge lighting.`,

  // 64. Pneumatic tube engineer
  `Create a scene of an engineer in a massive pneumatic tube control center. If it's a person, show them directing capsule traffic through a complex tube network. If it's a logo or non-human image, make it a capsule design or routing display. Hundreds of tubes, whooshing capsules, routing switches, Victorian control panels. Brass and leather with rushing air effects.`,

  // ===== HORROR / DARK SCIENTIST (65-72) =====

  // 65. Haunted laboratory
  `Transform this into a scientist in an abandoned, haunted research facility. If it's a person, show them investigating with flickering equipment, shadows moving wrong. If it's a logo or non-human image, make it appear as a ghostly projection or corrupted display. Dusty equipment, flickering lights, unexplained phenomena, creeping shadows. Sickly green and shadow-heavy lighting.`,

  // 66. Necromantic researcher
  `Create a scene of a scientist studying the boundary between life and death. If it's a person, show them clinically examining reanimated tissue samples. If it's a logo or non-human image, make it glow with unnatural life force. Life/death monitors, preserved specimens, reanimation equipment, ethical boundaries crossed. Deathly pale green and black lighting.`,

  // 67. Eldritch experimenter
  `Transform this into a scientist who has glimpsed cosmic horrors. If it's a person, show them with slightly unhinged expression, documenting impossible geometry. If it's a logo or non-human image, make it a symbol that hurts to look at. Non-Euclidean shapes, sanity meters, forbidden knowledge books, tentacle shadows. Unsettling purple and impossible colors.`,

  // 68. Vampire scientist
  `Create a scene of an immortal vampire conducting centuries of research. If it's a person, show them elegant and ancient, surrounded by experiments spanning ages. If it's a logo or non-human image, make it a family crest or blood analysis display. Gothic laboratory, blood research, immortality studies, daylight-proof windows. Crimson and midnight blue gothic lighting.`,

  // 69. Monster biologist
  `Transform this into a cryptozoologist studying captured mythical creatures. If it's a person, show them documenting a contained specimen with professional calm. If it's a logo or non-human image, make it a creature classification chart. Caged creatures, measurement equipment, weakness analyses, thick reinforced glass. Amber specimen lighting with creature bioluminescence.`,

  // 70. Curse researcher
  `Create a scene of a scientist clinically analyzing supernatural curses. If it's a person, show them with protective equipment, studying cursed artifacts. If it's a logo or non-human image, make it a curse sigil under analysis. Cursed objects in containment, curse progression charts, protective circles, bad luck counters. Ominous red curse glow against clinical white.`,

  // 71. Shadow experimenter
  `Transform this into a scientist studying living darkness. If it's a person, show them at the edge of light, observing sentient shadows. If it's a logo or non-human image, make it emerge from the darkness itself. Light containment fields, shadow specimens, darkness that moves wrong, fear monitors. Sharp contrast between light and living darkness.`,

  // 72. Plague doctor scientist
  `Create a scene of a modern scientist in stylized plague doctor aesthetic. If it's a person, show them in updated protective gear with the iconic mask, studying pathogens. If it's a logo or non-human image, make it the mask emblem or pathogen display. Biohazard containers, virus visualizations, quarantine protocols, herbal and chemical cures. Clinical white with medieval plague aesthetic accents.`,

  // ===== RETRO / VINTAGE SCIENCE (73-80) =====

  // 73. 1950s atomic age
  `Transform this into a 1950s atomic scientist in a retro-futuristic lab. If it's a person, give them period-appropriate styling with optimistic expression. If it's a logo or non-human image, make it an atomic symbol or retro display. Atom models, radiation badges, "Atomic Age" aesthetic, chrome and pastel colors. Optimistic nuclear green and chrome silver lighting.`,

  // 74. 1980s computer lab
  `Create a scene of a scientist in an 80s computing environment. If it's a person, show them with big hair and period fashion, multiple CRT monitors. If it's a logo or non-human image, make it pixel art on a screen. Green phosphor monitors, floppy disks, BASIC code, synthesizer music visualizations. CRT green and neon pink retrowave lighting.`,

  // 75. Pulp sci-fi explorer
  `Transform this into a pulp-era scientist adventurer on an alien world. If it's a person, give them a retro spacesuit and ray gun, confident pose. If it's a logo or non-human image, make it a rocket ship emblem or alien writing. Rocket ships with fins, bug-eyed aliens, impossible planets, ray gun science. Saturated pulp magazine color palette.`,

  // 76. Art deco futurist
  `Create a scene of a scientist in an art deco inspired future. If it's a person, show them in sleek geometric styling, surrounded by elegant machinery. If it's a logo or non-human image, make it a geometric deco pattern. Streamlined machines, geometric patterns, gold and silver surfaces, elegant future vision. Gold and black art deco luxury lighting.`,

  // 77. Cold War bunker scientist
  `Transform this into a scientist in a Cold War era underground bunker. If it's a person, show them monitoring radar and working on classified projects. If it's a logo or non-human image, make it a military insignia or classified project logo. Concrete walls, old computers, classified stamps, nuclear countdown clocks. Harsh fluorescent and warning red lighting.`,

  // 78. Space race engineer
  `Create a scene of a 1960s NASA-style engineer in mission control. If it's a person, show them with period styling, surrounded by analog equipment, moon mission in progress. If it's a logo or non-human image, make it a mission patch or trajectory display. Analog computers, mission clocks, rocket telemetry, historic moment atmosphere. Warm analog display orange and mission control blue.`,

  // 79. Disco era futurist
  `Transform this into a 1970s scientist imagining the future. If it's a person, give them period fashion with speculation about year 2000. If it's a logo or non-human image, make it a lava lamp pattern or early computer graphic. Lava lamps, early synthesizers, futurism magazines, optimistic predictions. Orange, brown, and gold 70s palette with chrome accents.`,

  // 80. Y2K tech researcher
  `Create a scene of a scientist during the Y2K scare era. If it's a person, show them frantically checking systems, countdown to midnight visible. If it's a logo or non-human image, make it the Y2K bug visualization or system status. Late 90s computers, Y2K countdowns, bug checking, millennial anxiety. Blue screen glow with millennium celebration colors.`,

  // ===== ELEMENTAL / NATURE FORCES (81-88) =====

  // 81. Storm chaser scientist
  `Transform this into a meteorologist in the heart of a massive storm. If it's a person, show them with weather equipment, tornado visible in background. If it's a logo or non-human image, make it the eye of the storm or radar signature. Mobile weather station, tornado in distance, lightning strikes, rain and wind. Dramatic storm lighting with green tornado conditions.`,

  // 82. Earthquake researcher
  `Create a scene of a seismologist monitoring tectonic activity. If it's a person, show them analyzing massive earthquake data, ground cracking visible. If it's a logo or non-human image, make it the seismic wave pattern. Seismographs going wild, earth cross-sections, fault line maps, shaking lab. Earthy brown and warning orange with tremor effects.`,

  // 83. Fire scientist
  `Transform this into a pyrotechnics expert studying controlled flames. If it's a person, show them in protective gear, commanding beautiful fire patterns. If it's a logo or non-human image, make it form in the flames. Various colored flames, burn pattern analysis, fire behavior models, heat shields. Warm fire spectrum from red to blue-white.`,

  // 84. Cryogenics specialist
  `Create a scene of a scientist in an extreme cold research facility. If it's a person, show them in heavy insulation, working with frozen specimens. If it's a logo or non-human image, make it crystallize in ice formations. Liquid nitrogen, frozen specimens, absolute zero experiments, frost everywhere. Ice blue and white frigid lighting.`,

  // 85. Aurora researcher
  `Transform this into a scientist studying the northern lights from a polar station. If it's a person, show them in wonder beneath dancing auroras, taking measurements. If it's a logo or non-human image, make it appear in the aurora patterns. Aurora borealis overhead, magnetic field equipment, polar research station. Vibrant green and purple aurora lighting.`,

  // 86. Solar physicist
  `Create a scene of a scientist studying the sun from a solar observatory. If it's a person, show them observing solar flares and sunspots on massive displays. If it's a logo or non-human image, make it a sunspot pattern or solar emblem. Solar telescopes, coronal mass ejections, magnetic field lines, heat warnings. Intense golden-orange solar glow.`,

  // 87. Tidal researcher
  `Transform this into an oceanographer studying massive tidal forces. If it's a person, show them in a coastal research station, walls of water visible. If it's a logo or non-human image, make it a tidal pattern or moon phase display. Tidal gauges, moon phase charts, wave prediction models, coastal lab. Deep blue ocean lighting with silver moonlight.`,

  // 88. Lightning harvester
  `Create a scene of a scientist capturing and storing lightning energy. If it's a person, show them operating massive tesla coils during a storm. If it's a logo or non-human image, make it the lightning capture point. Giant lightning rods, energy storage banks, storm overhead, electricity arcing. Electric blue and purple lightning with white-hot strikes.`,

  // ===== FOOD / UNUSUAL SCIENCE (89-96) =====

  // 89. Molecular gastronomy chef
  `Transform this into a chef-scientist practicing molecular gastronomy. If it's a person, show them creating impossible food with scientific precision. If it's a logo or non-human image, make it a spherified dish or chemical formula. Lab-kitchen hybrid, spherification, liquid nitrogen cooking, edible experiments. Clean white with colorful food accents.`,

  // 90. Brewing scientist
  `Create a scene of a master brewer in a high-tech fermentation lab. If it's a person, show them monitoring perfect brewing conditions with scientific precision. If it's a logo or non-human image, make it a yeast culture pattern or brew formula. Fermentation tanks, yeast microscopy, flavor compound charts, copper and steel. Warm amber beer colors with stainless steel.`,

  // 91. Chocolate scientist
  `Transform this into a confection scientist perfecting chocolate formulas. If it's a person, show them analyzing chocolate crystallization with dedication. If it's a logo or non-human image, make it a cocoa molecular structure. Tempering machines, crystal structure displays, taste testing stations, chocolate flows. Rich brown and gold luxury chocolate atmosphere.`,

  // 92. Perfume chemist
  `Create a scene of a fragrance scientist composing scent formulas. If it's a person, show them surrounded by hundreds of essence vials, creating perfect blends. If it's a logo or non-human image, make it a scent molecule visualization. Essence library, molecular diagrams, scent testing strips, elegant laboratory. Soft romantic lighting with visible scent trails.`,

  // 93. Color scientist
  `Transform this into a chromatics researcher studying color perception. If it's a person, show them surrounded by every possible color and shade. If it's a logo or non-human image, make it the center of a color wheel. Color wheels, perception tests, pigment samples, wavelength displays. Full spectrum rainbow lighting.`,

  // 94. Sound frequency researcher
  `Create a scene of an acoustician studying sound in an anechoic chamber. If it's a person, show them observing visible sound wave patterns. If it's a logo or non-human image, make it a frequency waveform. Sound-absorbing walls, frequency visualizations, resonance equipment, audio spectrum. Sound waves made visible in blue and purple.`,

  // 95. Texture engineer
  `Transform this into a materials scientist developing new textures. If it's a person, show them examining surface patterns at microscopic scale. If it's a logo or non-human image, make it a complex texture pattern. Surface samples, friction tests, microscope displays, tactile experiments. Clean white with magnified texture details.`,

  // 96. Memory researcher
  `Create a scene of a neuroscientist mapping memory formation. If it's a person, show them observing memories visualized as glowing pathways. If it's a logo or non-human image, make it a key memory pattern. Brain scans, memory playback displays, neural pathway maps, peaceful subjects. Soft blue neural glow with golden memory highlights.`,
];

/**
 * Result from getting the next prompt
 */
export interface PromptResult {
  prompt: string;
  promptIndex: number;  // Original index in SCIENTIST_PROMPTS array
  cyclePosition: number; // Position in current shuffle (1-17)
  totalPrompts: number;
}

/**
 * Result from AI image generation
 */
export interface AIImageResult {
  image: Buffer;
  promptUsed: string;
  promptIndex: number | null;  // null if custom prompt was used
  estimatedCost: number;       // USD
  model: 'gpt-image-1' | 'dall-e-3';
}

/**
 * Cycler state for persistence
 */
interface CyclerState {
  shuffledIndices: number[];
  currentIndex: number;
  lastUpdated: string;
}

/**
 * Prompt cycling system - ensures all prompts are used before repeating
 * Like shuffling a deck of cards and dealing through them
 * Persists state to survive bot reboots
 */
class PromptCycler {
  private shuffledIndices: number[] = [];
  private currentIndex = 0;
  private initialized = false;

  constructor(private prompts: string[]) {}

  /**
   * Initialize the cycler - loads state or creates new shuffle
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      await mkdir(join(process.cwd(), 'data'), { recursive: true });

      // Try to load existing state
      if (existsSync(CYCLER_STATE_FILE)) {
        const data = await readFile(CYCLER_STATE_FILE, 'utf-8');
        const state: CyclerState = JSON.parse(data);

        // Validate state matches current prompts count
        if (state.shuffledIndices.length === this.prompts.length) {
          this.shuffledIndices = state.shuffledIndices;
          this.currentIndex = state.currentIndex;
          logger.info(`Loaded prompt cycler state: position ${this.currentIndex + 1}/${this.prompts.length}`);
        } else {
          logger.warn('Prompt count changed, reshuffling');
          await this.reshuffle();
        }
      } else {
        await this.reshuffle();
      }
    } catch (error) {
      logger.warn('Failed to load cycler state, starting fresh:', error);
      await this.reshuffle();
    }

    this.initialized = true;
  }

  /**
   * Fisher-Yates shuffle algorithm - shuffles indices
   */
  private async reshuffle(): Promise<void> {
    // Create array of indices [0, 1, 2, ..., n-1]
    this.shuffledIndices = Array.from({ length: this.prompts.length }, (_, i) => i);

    // Shuffle
    for (let i = this.shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffledIndices[i], this.shuffledIndices[j]] = [this.shuffledIndices[j]!, this.shuffledIndices[i]!];
    }
    this.currentIndex = 0;
    logger.info(`Reshuffled ${this.shuffledIndices.length} prompts for new cycle`);
    await this.saveState();
  }

  /**
   * Save current state to file
   */
  private async saveState(): Promise<void> {
    try {
      const state: CyclerState = {
        shuffledIndices: this.shuffledIndices,
        currentIndex: this.currentIndex,
        lastUpdated: new Date().toISOString(),
      };
      await writeFile(CYCLER_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
      logger.warn('Failed to save cycler state:', error);
    }
  }

  /**
   * Get the next prompt in the cycle
   * Reshuffles when all prompts have been used
   */
  async next(): Promise<PromptResult> {
    await this.initialize();

    if (this.currentIndex >= this.shuffledIndices.length) {
      await this.reshuffle();
    }

    const promptIndex = this.shuffledIndices[this.currentIndex]!;
    const prompt = this.prompts[promptIndex]!;
    const cyclePosition = this.currentIndex + 1;

    this.currentIndex++;
    await this.saveState();

    logger.info(`Using prompt #${promptIndex + 1} (cycle position ${cyclePosition}/${this.shuffledIndices.length})`);

    return {
      prompt,
      promptIndex,
      cyclePosition,
      totalPrompts: this.prompts.length,
    };
  }

  /**
   * Get count of prompts remaining before reshuffle
   */
  remaining(): number {
    return this.shuffledIndices.length - this.currentIndex;
  }
}

// Single instance for the service lifetime
const promptCycler = new PromptCycler(SCIENTIST_PROMPTS);

/**
 * Get the next scientist prompt in the cycle
 */
async function getNextPrompt(): Promise<PromptResult> {
  return promptCycler.next();
}

/**
 * Get a prompt by its index (for reference/debugging)
 */
export function getPromptByIndex(index: number): string | undefined {
  return SCIENTIST_PROMPTS[index];
}

/**
 * Get total number of prompts available
 */
export function getTotalPromptCount(): number {
  return SCIENTIST_PROMPTS.length;
}

/**
 * Service for generating welcome images with lab-themed effects
 */
export class WelcomeImageService {
  private openaiApiKey: string | null = null;
  private storageInitialized = false;

  constructor() {
    this.openaiApiKey = process.env['OPENAI_API_KEY'] || null;
    if (this.openaiApiKey) {
      logger.info('AI image generation enabled (gpt-image-1)');
    }
  }

  /**
   * Ensure the storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    if (this.storageInitialized) return;

    await mkdir(IMAGE_STORAGE_DIR, { recursive: true });
    this.storageInitialized = true;
    logger.debug(`Image storage directory ready: ${IMAGE_STORAGE_DIR}`);
  }

  /**
   * Save an image to local storage
   * @returns The relative path to the saved image (for database storage)
   */
  async saveImage(
    imageBuffer: Buffer,
    guildId: string,
    userId: string,
    isAI: boolean
  ): Promise<string> {
    await this.ensureStorageDir();

    const timestamp = Date.now();
    const type = isAI ? 'ai' : 'programmatic';
    const filename = `${guildId}_${userId}_${timestamp}_${type}.png`;
    const filepath = join(IMAGE_STORAGE_DIR, filename);

    await writeFile(filepath, imageBuffer);
    logger.debug(`Saved welcome image: ${filename}`);

    // Return relative path for database storage
    return `welcome-images/${filename}`;
  }

  /**
   * Get the full path to the image storage directory
   */
  getStorageDir(): string {
    return IMAGE_STORAGE_DIR;
  }

  /**
   * Check if AI image generation is available
   */
  isAIImageAvailable(): boolean {
    return this.openaiApiKey !== null;
  }

  /**
   * Download image from URL as Buffer
   */
  async fetchImage(imageUrl: string): Promise<Buffer> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Alias for backward compatibility
   */
  async fetchAvatar(avatarUrl: string): Promise<Buffer> {
    return this.fetchImage(avatarUrl);
  }

  /**
   * Transform an image using OpenAI's gpt-image-1 model
   * This directly edits/transforms the input image based on the prompt
   */
  async transformImage(
    imageBuffer: Buffer,
    prompt: string
  ): Promise<Buffer> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    logger.debug('Transforming image with gpt-image-1');

    // Prepend likeness instruction to ensure the person's face is preserved
    const fullPrompt = LIKENESS_INSTRUCTION + prompt;

    // Ensure image is PNG format for the API
    const pngBuffer = await sharp(imageBuffer)
      .png()
      .toBuffer();

    // Create form data with the image
    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', fullPrompt);
    formData.append('size', AI_IMAGE_SIZE);
    formData.append('quality', AI_IMAGE_QUALITY);
    formData.append('image', new Blob([pngBuffer], { type: 'image/png' }), 'avatar.png');

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI Image Edit API error:', errorText);
      throw new Error(`OpenAI Image Edit API error: ${response.status}`);
    }

    const data = (await response.json()) as ImageEditResponse;

    // Get the base64 image data
    const imageData = data.data?.[0];
    if (!imageData) {
      throw new Error('No image data in response');
    }

    // Handle both base64 and URL responses
    if (imageData.b64_json) {
      logger.debug('Image transformation complete (base64)');
      return Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData.url) {
      logger.debug('Image transformation complete (url)');
      return this.fetchImage(imageData.url);
    }

    throw new Error('No image data in response');
  }

  /**
   * Generate a lab-themed AI welcome image by transforming user's avatar
   * Uses gpt-image-1 to directly transform the avatar into a scientist
   */
  async generateAIWelcomeImage(
    username: string,
    customPrompt?: string | null,
    avatarUrl?: string
  ): Promise<AIImageResult> {
    let promptText: string;
    let promptIndex: number | null = null;
    let usedDallE = false;

    // Use custom prompt if provided, otherwise get next in the cycle for variety
    if (customPrompt) {
      promptText = customPrompt;
    } else {
      const promptResult = await getNextPrompt();
      promptText = promptResult.prompt;
      promptIndex = promptResult.promptIndex;
      logger.info(`Selected prompt #${promptIndex + 1} (${promptResult.cyclePosition}/${promptResult.totalPrompts} in cycle)`);
    }

    let transformedImage: Buffer;

    if (avatarUrl) {
      // Fetch the avatar
      const avatarBuffer = await this.fetchImage(avatarUrl);

      // Transform it using gpt-image-1
      transformedImage = await this.transformImage(avatarBuffer, promptText);

      logger.info(`Transformed avatar for ${username} using gpt-image-1`);
    } else {
      // No avatar provided, generate a generic scientist image
      transformedImage = await this.generateGenericScientist(username, promptText);
      usedDallE = true;
    }

    // Add welcome overlay
    const finalImage = await this.addWelcomeOverlay(transformedImage, username);

    // Calculate estimated cost
    const estimatedCost = usedDallE ? PRICING['dall-e-3-hd-wide'] : PRICING['gpt-image-1'];

    return {
      image: finalImage,
      promptUsed: promptText,
      promptIndex,
      estimatedCost,
      model: usedDallE ? 'dall-e-3' : 'gpt-image-1',
    };
  }

  /**
   * Generate a generic scientist image when no avatar is provided
   */
  private async generateGenericScientist(username: string, style: string): Promise<Buffer> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    logger.debug('Generating generic scientist image with DALL-E');

    const prompt = `Create a cool scientist character portrait. ${style}. This is for "${username}" joining a tech gaming community. Digital art style, cinematic lighting.`;

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: AI_IMAGE_SIZE,
        quality: 'hd',
        style: 'vivid',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('DALL-E API error:', errorText);
      throw new Error(`DALL-E API error: ${response.status}`);
    }

    const data = (await response.json()) as DALLEResponse;
    const imageData = data.data[0];

    if (!imageData?.url) {
      throw new Error('No image URL in DALL-E response');
    }

    return this.fetchImage(imageData.url);
  }

  /**
   * Add welcome text overlay to an image
   */
  private async addWelcomeOverlay(imageBuffer: Buffer, username: string): Promise<Buffer> {
    const escapedUsername = this.escapeXml(username);

    // Create semi-transparent overlay for text readability
    const textOverlay = Buffer.from(
      `<svg width="${CANVAS_WIDTH}" height="80">
        <rect x="0" y="0" width="${CANVAS_WIDTH}" height="80" fill="rgba(0,0,0,0.6)" rx="10"/>
        <text x="${CANVAS_WIDTH / 2}" y="52"
          font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="bold"
          fill="white" text-anchor="middle">
          Welcome, ${escapedUsername}!
        </text>
      </svg>`
    );

    // Resize the image and add overlay
    const finalImage = await sharp(imageBuffer)
      .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'cover' })
      .composite([
        {
          input: await sharp(textOverlay).png().toBuffer(),
          top: CANVAS_HEIGHT - 100,
          left: 0,
        },
      ])
      .png({ compressionLevel: 6 })
      .toBuffer();

    return finalImage;
  }

  /**
   * Create circular mask SVG for avatar cropping
   */
  private createCircleMask(size: number): Buffer {
    return Buffer.from(
      `<svg width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
      </svg>`
    );
  }

  /**
   * Create neon glow ring SVG
   */
  private createGlowRing(size: number, color: string): Buffer {
    const strokeWidth = Math.floor(size * 0.025);
    const glowSize = Math.floor(size * 0.06);
    const radius = size / 2 - strokeWidth - glowSize;

    return Buffer.from(
      `<svg width="${size}" height="${size}">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="${glowSize}" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="blur"/>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle
          cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="${color}" stroke-width="${strokeWidth}"
          filter="url(#glow)"
        />
      </svg>`
    );
  }

  /**
   * Escape XML special characters for SVG text
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Generate the welcome image with lab-themed styling (programmatic version)
   */
  async generateWelcomeImage(
    avatarUrl: string,
    username: string,
    glowColor: string = '#00D4FF'
  ): Promise<Buffer> {
    logger.debug(`Generating programmatic welcome image for ${username}`);

    const avatarBuffer = await this.fetchAvatar(avatarUrl);

    const circularAvatar = await sharp(avatarBuffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .composite([
        {
          input: this.createCircleMask(AVATAR_SIZE),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    const glowRingSize = AVATAR_SIZE + 40;
    const glowRingBuffer = await sharp(this.createGlowRing(glowRingSize, glowColor))
      .png()
      .toBuffer();

    const background = await sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 4,
        background: { r: 30, g: 31, b: 34, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const escapedUsername = this.escapeXml(username);
    const welcomeText = Buffer.from(
      `<svg width="${CANVAS_WIDTH}" height="60">
        <text x="${CANVAS_WIDTH / 2}" y="45"
          font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="bold"
          fill="white" text-anchor="middle">
          Welcome, ${escapedUsername}!
        </text>
      </svg>`
    );

    const avatarTop = Math.floor((CANVAS_HEIGHT - AVATAR_SIZE) / 2) - 30;
    const avatarLeft = Math.floor((CANVAS_WIDTH - AVATAR_SIZE) / 2);
    const glowTop = avatarTop - 20;
    const glowLeft = avatarLeft - 20;
    const textTop = avatarTop + AVATAR_SIZE + 20;

    const finalImage = await sharp(background)
      .composite([
        { input: glowRingBuffer, top: glowTop, left: glowLeft },
        { input: circularAvatar, top: avatarTop, left: avatarLeft },
        { input: await sharp(welcomeText).png().toBuffer(), top: textTop, left: 0 },
      ])
      .png({ compressionLevel: 6 })
      .toBuffer();

    logger.debug(`Programmatic image generated for ${username}`);
    return finalImage;
  }
}

// API Response types
interface DALLEResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

interface ImageEditResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
}
