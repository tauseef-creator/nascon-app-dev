// App-wide icon component backed by Phosphor (https://phosphoricons.com, MIT).
// Screens keep using Ionicons-style names; this module maps each name to a Phosphor glyph and
// weight: "*-outline" names render the light "regular" weight (inactive / secondary), filled
// names render "fill" (active / emphasis). Each icon is imported individually to keep the bundle small.
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ArrowClockwiseIcon } from 'phosphor-icons/ArrowClockwise';
import { ArrowRightIcon } from 'phosphor-icons/ArrowRight';
import { ArrowsClockwiseIcon } from 'phosphor-icons/ArrowsClockwise';
import { ArrowsLeftRightIcon } from 'phosphor-icons/ArrowsLeftRight';
import { ArrowUUpLeftIcon } from 'phosphor-icons/ArrowUUpLeft';
import { BroadcastIcon } from 'phosphor-icons/Broadcast';
import { CalendarBlankIcon } from 'phosphor-icons/CalendarBlank';
import { CaretLeftIcon } from 'phosphor-icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-icons/CaretRight';
import { CaretUpIcon } from 'phosphor-icons/CaretUp';
import { CheckCircleIcon } from 'phosphor-icons/CheckCircle';
import { CheckIcon } from 'phosphor-icons/Check';
import { ChecksIcon } from 'phosphor-icons/Checks';
import { CircleIcon } from 'phosphor-icons/Circle';
import { ClockIcon } from 'phosphor-icons/Clock';
import { CloudArrowUpIcon } from 'phosphor-icons/CloudArrowUp';
import { CloudCheckIcon } from 'phosphor-icons/CloudCheck';
import { CloudSlashIcon } from 'phosphor-icons/CloudSlash';
import { CodeIcon } from 'phosphor-icons/Code';
import { CopyIcon } from 'phosphor-icons/Copy';
import { CreditCardIcon } from 'phosphor-icons/CreditCard';
import { EyeIcon } from 'phosphor-icons/Eye';
import { EyeSlashIcon } from 'phosphor-icons/EyeSlash';
import { FileTextIcon } from 'phosphor-icons/FileText';
import { FlagIcon } from 'phosphor-icons/Flag';
import { FloppyDiskIcon } from 'phosphor-icons/FloppyDisk';
import { GearIcon } from 'phosphor-icons/Gear';
import { HandbagIcon } from 'phosphor-icons/Handbag';
import { HouseIcon } from 'phosphor-icons/House';
import { InfoIcon } from 'phosphor-icons/Info';
import { LockIcon } from 'phosphor-icons/Lock';
import { LockOpenIcon } from 'phosphor-icons/LockOpen';
import { MapPinIcon } from 'phosphor-icons/MapPin';
import { MapTrifoldIcon } from 'phosphor-icons/MapTrifold';
import { MinusCircleIcon } from 'phosphor-icons/MinusCircle';
import { MinusIcon } from 'phosphor-icons/Minus';
import { PauseCircleIcon } from 'phosphor-icons/PauseCircle';
import { PlayCircleIcon } from 'phosphor-icons/PlayCircle';
import { PlayIcon } from 'phosphor-icons/Play';
import { PlusCircleIcon } from 'phosphor-icons/PlusCircle';
import { PlusIcon } from 'phosphor-icons/Plus';
import { ProhibitIcon } from 'phosphor-icons/Prohibit';
import { PulseIcon } from 'phosphor-icons/Pulse';
import { QuestionIcon } from 'phosphor-icons/Question';
import { RadioButtonIcon } from 'phosphor-icons/RadioButton';
import { RankingIcon } from 'phosphor-icons/Ranking';
import { ReceiptIcon } from 'phosphor-icons/Receipt';
import { ShieldCheckIcon } from 'phosphor-icons/ShieldCheck';
import { ShieldChevronIcon } from 'phosphor-icons/ShieldChevron';
import { ShieldIcon } from 'phosphor-icons/Shield';
import { ShoppingBagIcon } from 'phosphor-icons/ShoppingBag';
import { ShoppingCartIcon } from 'phosphor-icons/ShoppingCart';
import { SignInIcon } from 'phosphor-icons/SignIn';
import { SignOutIcon } from 'phosphor-icons/SignOut';
import { StarIcon } from 'phosphor-icons/Star';
import { StopCircleIcon } from 'phosphor-icons/StopCircle';
import { TagIcon } from 'phosphor-icons/Tag';
import { TextTIcon } from 'phosphor-icons/TextT';
import { TrashIcon } from 'phosphor-icons/Trash';
import { TrophyIcon } from 'phosphor-icons/Trophy';
import { UserCircleIcon } from 'phosphor-icons/UserCircle';
import { UserIcon } from 'phosphor-icons/User';
import { UserPlusIcon } from 'phosphor-icons/UserPlus';
import { UsersIcon } from 'phosphor-icons/Users';
import { WarningCircleIcon } from 'phosphor-icons/WarningCircle';
import { WarningIcon } from 'phosphor-icons/Warning';
import { XCircleIcon } from 'phosphor-icons/XCircle';
import { XIcon } from 'phosphor-icons/X';
import { BellIcon } from 'phosphor-icons/Bell';
import { ChatsCircleIcon } from 'phosphor-icons/ChatsCircle';
import { GridFourIcon } from 'phosphor-icons/GridFour';
import { KeyIcon } from 'phosphor-icons/Key';
import { LinkIcon } from 'phosphor-icons/Link';
import { MicrophoneIcon } from 'phosphor-icons/Microphone';
import { MicrophoneSlashIcon } from 'phosphor-icons/MicrophoneSlash';
import { QrCodeIcon } from 'phosphor-icons/QrCode';
import { ScanIcon } from 'phosphor-icons/Scan';
import { UserMinusIcon } from 'phosphor-icons/UserMinus';
import { VideoCameraIcon } from 'phosphor-icons/VideoCamera';
import { CrownIcon } from 'phosphor-icons/Crown';

type Weight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
type Glyph = React.ComponentType<{ size?: number; color?: string; weight?: Weight; style?: StyleProp<ViewStyle> }>;

// name -> [Phosphor glyph, weight]
const MAP = {
  add: [PlusIcon, 'bold'],
  'add-circle': [PlusCircleIcon, 'fill'],
  alert: [WarningIcon, 'bold'],
  'alert-circle': [WarningCircleIcon, 'fill'],
  'alert-circle-outline': [WarningCircleIcon, 'regular'],
  'arrow-forward': [ArrowRightIcon, 'bold'],
  'arrow-undo': [ArrowUUpLeftIcon, 'bold'],
  'arrow-undo-circle': [ArrowUUpLeftIcon, 'bold'],
  bag: [ShoppingBagIcon, 'fill'],
  'bag-add-outline': [ShoppingBagIcon, 'regular'],
  'bag-handle-outline': [HandbagIcon, 'regular'],
  'bag-outline': [ShoppingBagIcon, 'regular'],
  ban: [ProhibitIcon, 'bold'],
  'calendar-outline': [CalendarBlankIcon, 'regular'],
  card: [CreditCardIcon, 'fill'],
  'card-outline': [CreditCardIcon, 'regular'],
  cart: [ShoppingCartIcon, 'fill'],
  'cart-outline': [ShoppingCartIcon, 'regular'],
  checkmark: [CheckIcon, 'bold'],
  'checkmark-circle': [CheckCircleIcon, 'fill'],
  'checkmark-done': [ChecksIcon, 'bold'],
  'checkmark-done-circle-outline': [ChecksIcon, 'regular'],
  'chevron-back': [CaretLeftIcon, 'bold'],
  'chevron-forward': [CaretRightIcon, 'bold'],
  'chevron-up': [CaretUpIcon, 'bold'],
  close: [XIcon, 'bold'],
  'close-circle': [XCircleIcon, 'fill'],
  'close-circle-outline': [XCircleIcon, 'regular'],
  'cloud-done': [CloudCheckIcon, 'fill'],
  'cloud-offline': [CloudSlashIcon, 'fill'],
  'cloud-offline-outline': [CloudSlashIcon, 'regular'],
  'cloud-upload': [CloudArrowUpIcon, 'fill'],
  'cloud-upload-outline': [CloudArrowUpIcon, 'regular'],
  'code-slash': [CodeIcon, 'regular'],
  'copy-outline': [CopyIcon, 'regular'],
  'document-text-outline': [FileTextIcon, 'regular'],
  duplicate: [CopyIcon, 'fill'],
  ellipse: [CircleIcon, 'fill'],
  'ellipse-outline': [CircleIcon, 'regular'],
  'exit-outline': [SignOutIcon, 'regular'],
  eye: [EyeIcon, 'regular'],
  'eye-off': [EyeSlashIcon, 'regular'],
  flag: [FlagIcon, 'fill'],
  'help-circle': [QuestionIcon, 'fill'],
  home: [HouseIcon, 'fill'],
  'home-outline': [HouseIcon, 'regular'],
  'information-circle': [InfoIcon, 'fill'],
  'information-circle-outline': [InfoIcon, 'regular'],
  location: [MapPinIcon, 'fill'],
  'lock-closed': [LockIcon, 'fill'],
  'lock-closed-outline': [LockIcon, 'regular'],
  'lock-open': [LockOpenIcon, 'fill'],
  'log-in-outline': [SignInIcon, 'regular'],
  'log-out-outline': [SignOutIcon, 'regular'],
  'map-outline': [MapTrifoldIcon, 'regular'],
  'pause-circle': [PauseCircleIcon, 'fill'],
  'pause-circle-outline': [PauseCircleIcon, 'regular'],
  people: [UsersIcon, 'fill'],
  'people-outline': [UsersIcon, 'regular'],
  person: [UserIcon, 'fill'],
  'person-add-outline': [UserPlusIcon, 'regular'],
  'person-circle': [UserCircleIcon, 'fill'],
  'person-circle-outline': [UserCircleIcon, 'regular'],
  play: [PlayIcon, 'fill'],
  'play-circle': [PlayCircleIcon, 'fill'],
  podium: [RankingIcon, 'fill'],
  'podium-outline': [RankingIcon, 'regular'],
  pricetag: [TagIcon, 'fill'],
  'pricetag-outline': [TagIcon, 'regular'],
  pulse: [PulseIcon, 'bold'],
  radio: [BroadcastIcon, 'bold'],
  'radio-button-off': [CircleIcon, 'regular'],
  'radio-button-on': [RadioButtonIcon, 'fill'],
  'receipt-outline': [ReceiptIcon, 'regular'],
  refresh: [ArrowClockwiseIcon, 'bold'],
  remove: [MinusIcon, 'bold'],
  'remove-circle': [MinusCircleIcon, 'fill'],
  'save-outline': [FloppyDiskIcon, 'regular'],
  settings: [GearIcon, 'fill'],
  'settings-outline': [GearIcon, 'regular'],
  'shield-checkmark': [ShieldCheckIcon, 'fill'],
  'shield-half': [ShieldChevronIcon, 'fill'],
  'shield-half-outline': [ShieldChevronIcon, 'regular'],
  'shield-outline': [ShieldIcon, 'regular'],
  star: [StarIcon, 'fill'],
  'stop-circle-outline': [StopCircleIcon, 'regular'],
  'swap-horizontal': [ArrowsLeftRightIcon, 'bold'],
  sync: [ArrowsClockwiseIcon, 'bold'],
  text: [TextTIcon, 'regular'],
  'time-outline': [ClockIcon, 'regular'],
  'trash-outline': [TrashIcon, 'regular'],
  trophy: [TrophyIcon, 'fill'],
  'trophy-outline': [TrophyIcon, 'regular'],
  warning: [WarningIcon, 'fill'],
  chatbubbles: [ChatsCircleIcon, 'fill'],
  'chatbubbles-outline': [ChatsCircleIcon, 'regular'],
  grid: [GridFourIcon, 'fill'],
  'grid-outline': [GridFourIcon, 'regular'],
  key: [KeyIcon, 'regular'],
  link: [LinkIcon, 'regular'],
  mic: [MicrophoneIcon, 'fill'],
  'mic-off': [MicrophoneSlashIcon, 'fill'],
  notifications: [BellIcon, 'fill'],
  'qr-code': [QrCodeIcon, 'fill'],
  'qr-code-outline': [QrCodeIcon, 'regular'],
  scan: [ScanIcon, 'bold'],
  'person-remove': [UserMinusIcon, 'regular'],
  videocam: [VideoCameraIcon, 'fill'],
  'videocam-outline': [VideoCameraIcon, 'regular'],
  crown: [CrownIcon, 'fill'],
} satisfies Record<string, readonly [Glyph, Weight]>;

export type IconName = keyof typeof MAP;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Override the weight implied by the name (e.g. 'bold' for small badges). */
  weight?: Weight;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

function IconComponent({ name, size = 24, color = '#FFFFFF', weight, style }: Props) {
  const entry = (MAP as Record<string, readonly [Glyph, Weight]>)[name] ?? [QuestionIcon, 'regular'];
  const [Glyph, implied] = entry;
  return <Glyph size={size} color={color} weight={weight ?? implied} style={style} />;
}

/** Drop-in replacement for `Ionicons`: same `name`/`size`/`color` props and a `glyphMap` for typing. */
export const Icon = Object.assign(IconComponent, { glyphMap: MAP });
