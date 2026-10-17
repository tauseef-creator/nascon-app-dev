import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/tabs';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../../src/store/CartContext';
import { colors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function TabsLayout() {
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const icon = (name: IconName, active: IconName) =>
    function TabIcon({ color, focused }: { color: any; focused: boolean }) {
      return <Ionicons name={focused ? active : name} size={24} color={color} />;
    };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: '#0D0D0D',
          borderTopColor: colors.divider,
          borderTopWidth: 0.5,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarItemStyle: { minHeight: 48 },
        tabBarBadgeStyle: { backgroundColor: colors.live, color: colors.white, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Fixtures', tabBarIcon: icon('football-outline', 'football'), tabBarButtonTestID: 'tab-fixtures', tabBarAccessibilityLabel: 'Fixtures tab' }}
      />
      <Tabs.Screen
        name="standings"
        options={{ title: 'Standings', tabBarIcon: icon('trophy-outline', 'trophy'), tabBarButtonTestID: 'tab-standings', tabBarAccessibilityLabel: 'Standings tab' }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: 'Store',
          tabBarIcon: icon('bag-outline', 'bag'),
          tabBarButtonTestID: 'tab-store',
          tabBarAccessibilityLabel: cart.count ? `Store tab, ${cart.count} items in cart` : 'Store tab',
          tabBarBadge: cart.count ? cart.count : undefined,
        }}
      />
      <Tabs.Screen
        name="club"
        options={{ title: 'Club', tabBarIcon: icon('shield-half-outline', 'shield-half'), tabBarButtonTestID: 'tab-club', tabBarAccessibilityLabel: 'Club tab' }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon('person-circle-outline', 'person-circle'), tabBarButtonTestID: 'tab-more', tabBarAccessibilityLabel: 'More tab' }}
      />
    </Tabs>
  );
}
