import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import PintGlassIcon from '../components/PintGlassIcon';

const Tab = createBottomTabNavigator();

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: DARK_GREY,
        tabBarInactiveTintColor: MEDIUM_GREY,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: LIGHT_GREY,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen 
        name="Map" 
        component={MapScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <PintGlassIcon size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <PintGlassIcon size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}