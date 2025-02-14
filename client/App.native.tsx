import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/lib/queryClient";
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { CoursesScreen } from './src/screens/CoursesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import type { RootStackParamList } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<RootStackParamList>();

function TabNavigator() {
  return (
    <Tab.Navigator>
      <Tab.Screen 
        name="Home" 
        component={HomeScreen}
        options={{ title: 'Trang chủ' }}
      />
      <Tab.Screen 
        name="Courses" 
        component={CoursesScreen}
        options={{ title: 'Khóa học' }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{ title: 'Cá nhân' }}
      />
    </Tab.Navigator>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen 
              name="Main" 
              component={TabNavigator}
              options={{ headerShown: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export default App;