import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color="#757575" />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage || 'This screen encountered an unexpected error.'}
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleRetry}>
            <MaterialCommunityIcons name="refresh" size={20} color="#FFFFFF" />
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C2C2C',
    marginTop: 16,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: '#757575',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C2C2C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
