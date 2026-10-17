import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/tabs';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../../src/auth/AuthContext';
import { useCart } from '../../src/store/CartContext';
import { colors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function TabsLayout() {
  const brand = useBrand();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const icon = (name: IconName, active: IconName) =>
    function TabIcon({ color, focused }: { color: any; focused: boolean }) {
      return <Ionicons name={focused ? active : name} size={26} color={color} />;
    };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: brand.primaryText,
        tabBarInactiveTintColor: '#4B5563',
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.divider,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Fixtures', tabBarIcon: icon('calendar-outline', 'calendar'), tabBarButtonTestID: 'tab-fixtures', tabBarAccessibilityLabel: 'Fixtures tab' }}
      />
      <Tabs.Screen
        name="standings"
        options={{ title: 'Standings', tabBarIcon: icon('podium-outline', 'podium'), tabBarButtonTestID: 'tab-standings', tabBarAccessibilityLabel: 'Standings tab' }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: 'Store',
          tabBarIcon: icon('bag-handle-outline', 'bag-handle'),
          tabBarButtonTestID: 'tab-store',
          tabBarAccessibilityLabel: cart.count ? `Store tab, ${cart.count} items in cart` : 'Store tab',
          tabBarBadge: cart.count ? cart.count : undefined,
        }}
      />
      <Tabs.Screen
        name="club"
        options={{ title: 'Club', tabBarIcon: icon('shield-outline', 'shield'), tabBarButtonTestID: 'tab-club', tabBarAccessibilityLabel: 'Club tab' }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon('menu-outline', 'menu'), tabBarButtonTestID: 'tab-more', tabBarAccessibilityLabel: 'More tab' }}
      />
    </Tabs>
  );
}
