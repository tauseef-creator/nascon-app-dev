import { Icon } from '../../src/components/Icon';
import { Tabs } from 'expo-router/tabs';
import type { BottomTabBarProps } from 'expo-router/tabs';
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCart } from '../../src/store/CartContext';
import { colors, TOUCH } from '../../src/theme';

type IconName = React.ComponentProps<typeof Icon>['name'];

// Regular (thin) glyph when inactive, filled glyph when active.
const TAB_ICONS: Record<string, [IconName, IconName]> = {
  index: ['home-outline', 'home'],
  standings: ['trophy-outline', 'trophy'],
  store: ['bag-outline', 'bag'],
  club: ['shield-half-outline', 'shield-half'],
  more: ['person-circle-outline', 'person-circle'],
};

const BAR_BG = '#0A0A0B';
const PILL_BG = colors.accentBg;

function TabItem({
  label,
  icons,
  focused,
  badge,
  testID,
  accessibilityLabel,
  onPress,
  onLongPress,
}: {
  label: string;
  icons: [IconName, IconName];
  focused: boolean;
  badge?: number | string;
  testID?: string;
  accessibilityLabel?: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [focused, anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const tint = focused ? colors.accent : colors.textMuted;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.pillWrap}>
        <Animated.View pointerEvents="none" style={[styles.pill, { opacity: anim, transform: [{ scale }] }]} />
        <View>
          <Icon name={focused ? icons[1] : icons[0]} size={24} color={tint} />
          {badge !== undefined && badge !== '' ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {typeof badge === 'number' && badge > 99 ? '99+' : badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function PremiumTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const { options } = descriptors[route.key]!;
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const onLongPress = () => emitter.emit({ type: 'tabLongPress', target: route.key });
        return (
          <TabItem
            key={route.key}
            label={label}
            icons={TAB_ICONS[route.name] ?? ['ellipse-outline', 'ellipse']}
            focused={focused}
            badge={options.tabBarBadge}
            testID={options.tabBarButtonTestID}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const cart = useCart();
  return (
    <Tabs tabBar={(props) => <PremiumTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarButtonTestID: 'tab-fixtures', tabBarAccessibilityLabel: 'Home tab: your dashboard and fixtures' }}
      />
      <Tabs.Screen name="standings" options={{ title: 'Standings', tabBarButtonTestID: 'tab-standings', tabBarAccessibilityLabel: 'Standings tab' }} />
      <Tabs.Screen
        name="store"
        options={{
          title: 'Store',
          tabBarButtonTestID: 'tab-store',
          tabBarAccessibilityLabel: cart.count ? `Store tab, ${cart.count} items in cart` : 'Store tab',
          tabBarBadge: cart.count ? cart.count : undefined,
        }}
      />
      <Tabs.Screen name="club" options={{ title: 'Club', tabBarButtonTestID: 'tab-club', tabBarAccessibilityLabel: 'Club tab' }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarButtonTestID: 'tab-more', tabBarAccessibilityLabel: 'More tab' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: BAR_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  item: { flex: 1, minHeight: TOUCH + 8, alignItems: 'center', justifyContent: 'center' },
  pillWrap: { minWidth: 64, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', gap: 3 },
  pill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 18, backgroundColor: PILL_BG },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.1 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.live,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BAR_BG,
  },
  badgeText: { color: colors.white, fontSize: 10, fontFamily: 'Inter_700Bold' },
});
